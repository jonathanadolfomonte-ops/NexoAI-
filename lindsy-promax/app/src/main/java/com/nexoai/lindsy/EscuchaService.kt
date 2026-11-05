package com.nexoai.lindsy

import ai.picovoice.porcupine.Porcupine
import ai.picovoice.porcupine.PorcupineManager
import ai.picovoice.porcupine.PorcupineManagerCallback
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

object Util {
    fun textoCorto(t: String): String {
        val frases = t.trim().split(Regex("""(?<=[.!?])\s+"""))
        var salida = ""
        for (f in frases) {
            if (salida.isNotEmpty() && salida.length + f.length > 450) break
            salida = if (salida.isEmpty()) f else salida + " " + f
        }
        return salida
    }

    fun pedirLindsy(ctx: Context, texto: String): String {
        val clave = ctx.getSharedPreferences("lindsy", Context.MODE_PRIVATE).getString("clave", "") ?: ""
        val c = (URL("https://nexoai-personal.onrender.com/api/lindsy").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 90000
            doOutput = true
            setRequestProperty("Authorization", "Bearer " + clave)
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
        c.outputStream.use { it.write(JSONObject().put("texto", texto).toString().toByteArray(Charsets.UTF_8)) }
        val codigo = c.responseCode
        val cuerpo = (if (codigo < 400) c.inputStream else c.errorStream)
            ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val json = try { JSONObject(cuerpo) } catch (e: Exception) { JSONObject() }
        return when (codigo) {
            200 -> json.optString("respuesta", "No entendí la respuesta del servidor.")
            401 -> "La clave de la app es incorrecta."
            else -> json.optString("error", "El servidor respondió con el error $codigo.")
        }
    }
}

class EscuchaService : Service(), TextToSpeech.OnInitListener {
    companion object {
        const val ACCION_PARAR = "com.nexoai.lindsy.PARAR"
        const val CANAL = "lindsy_escucha"
        @Volatile var activo = false
    }

    private val ui = Handler(Looper.getMainLooper())
    private var porcupine: PorcupineManager? = null
    private var voz: TextToSpeech? = null
    private var vozLista = false
    private var reconocedor: SpeechRecognizer? = null
    private var ocupado = false
    private var esperando = false
    private var alTerminarDeHablar: (() -> Unit)? = null
    private var contador = 0
    private var idActual = ""
    private val cierre = Regex("""^(chau|chao|listo|terminar|nada más|nada mas|gracias lindsy|gracias)[.! ]*$""", RegexOption.IGNORE_CASE)
    private val avisoLento = Runnable {
        if (esperando) hablar("Un momento, estoy conectando.") { }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACCION_PARAR) {
            detener()
            return START_NOT_STICKY
        }
        val n = notificacion("Escuchando… decí la palabra de activación")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(1, n)
        }
        if (porcupine == null) iniciar()
        return START_NOT_STICKY
    }

    private fun notificacion(texto: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CANAL, "Lindsy escucha", NotificationManager.IMPORTANCE_LOW))
        }
        val parar = PendingIntent.getService(this, 0, Intent(this, EscuchaService::class.java).setAction(ACCION_PARAR), PendingIntent.FLAG_IMMUTABLE)
        val abrir = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CANAL) else Notification.Builder(this)
        return b.setContentTitle("Lindsy ProMax")
            .setContentText(texto)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(abrir)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", parar)
            .setOngoing(true)
            .build()
    }

    private fun iniciar() {
        val p = getSharedPreferences("lindsy", Context.MODE_PRIVATE)
        val claveVoz = p.getString("picovoice", "")?.trim().orEmpty()
        if (claveVoz.isEmpty()) {
            avisarYParar("Falta la clave de Picovoice.")
            return
        }
        voz = TextToSpeech(this, this)
        try {
            val b = PorcupineManager.Builder().setAccessKey(claveVoz).setSensitivity(0.65f)
            val ppn = File(filesDir, "palabra.ppn")
            if (ppn.exists()) b.setKeywordPath(ppn.absolutePath) else b.setKeyword(Porcupine.BuiltInKeyword.JARVIS)
            porcupine = b.build(applicationContext, PorcupineManagerCallback { ui.post { alDetectar() } })
            porcupine?.start()
            activo = true
        } catch (e: Exception) {
            avisarYParar("No pude iniciar la escucha: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun avisarYParar(mensaje: String) {
        Toast.makeText(this, mensaje, Toast.LENGTH_LONG).show()
        detener()
    }

    override fun onInit(resultado: Int) {
        if (resultado != TextToSpeech.SUCCESS) return
        var r = voz?.setLanguage(Locale("es", "AR"))
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            r = voz?.setLanguage(Locale("es"))
        }
        vozLista = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
        val p = getSharedPreferences("lindsy", Context.MODE_PRIVATE)
        voz?.setSpeechRate(p.getFloat("tasa", 0.95f))
        voz?.setPitch(p.getFloat("tono", 1.0f))
        voz?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onError(id: String?) { fin(id) }
            override fun onDone(id: String?) { fin(id) }
        })
    }

    private fun fin(id: String?) {
        ui.post {
            if (id == idActual) {
                val f = alTerminarDeHablar
                alTerminarDeHablar = null
                f?.invoke()
            }
        }
    }

    private fun hablar(texto: String, despues: () -> Unit) {
        if (!vozLista) {
            despues()
            return
        }
        contador++
        idActual = "l" + contador
        alTerminarDeHablar = despues
        voz?.speak(Util.textoCorto(texto), TextToSpeech.QUEUE_FLUSH, null, idActual)
    }

    private fun pausarPalabra() {
        try { porcupine?.stop() } catch (e: Exception) { }
    }

    private fun reanudarPalabra() {
        try { porcupine?.start() } catch (e: Exception) { }
    }

    private fun alDetectar() {
        if (ocupado || !activo) return
        ocupado = true
        pausarPalabra()
        hablar("Sí, decime.") { escucharOrden() }
    }

    private fun terminar() {
        ocupado = false
        esperando = false
        reconocedor?.destroy()
        reconocedor = null
        if (activo) reanudarPalabra()
    }

    private fun escucharOrden() {
        if (!activo) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            terminar()
            return
        }
        reconocedor?.destroy()
        reconocedor = SpeechRecognizer.createSpeechRecognizer(this).also { sr ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onError(error: Int) { terminar() }
                override fun onResults(results: Bundle?) {
                    val texto = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    if (texto.isEmpty()) terminar() else atender(texto)
                }
            })
            val intento = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-AR")
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L)
            }
            sr.startListening(intento)
        }
    }

    private fun atender(orden: String) {
        val termina = cierre.matches(orden)
        esperando = true
        ui.postDelayed(avisoLento, 7000)
        thread {
            val respuesta = try {
                Util.pedirLindsy(this, orden)
            } catch (e: Exception) {
                "No pude conectarme con Lindsy. Revisá la conexión a internet."
            }
            ui.post {
                ui.removeCallbacks(avisoLento)
                esperando = false
                if (activo) {
                    hablar(respuesta) { if (termina) terminar() else escucharOrden() }
                }
            }
        }
    }

    private fun liberar() {
        activo = false
        ui.removeCallbacksAndMessages(null)
        try { porcupine?.stop() } catch (e: Exception) { }
        try { porcupine?.delete() } catch (e: Exception) { }
        porcupine = null
        reconocedor?.destroy()
        reconocedor = null
        voz?.stop()
        voz?.shutdown()
        voz = null
    }

    private fun detener() {
        liberar()
        stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() {
        liberar()
        super.onDestroy()
    }
}
