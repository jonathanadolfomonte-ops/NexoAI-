package com.nexoai.lindsy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
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
    private var voz: TextToSpeech? = null
    private var vozLista = false
    private var reconocedor: SpeechRecognizer? = null
    private var esperandoOrden = false
    private var esperando = false
    private var alTerminarDeHablar: (() -> Unit)? = null
    private var contador = 0
    private var idActual = ""
    private var bloqueo: PowerManager.WakeLock? = null
    private val palabraClave = Regex("""\b(lindsy|lindsi|lindsay|lindsey|lindzy|lindzi|linchi|linsi|linsy|lincy|lindi)\b[,.!?]*\s*""", RegexOption.IGNORE_CASE)
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
        val n = notificacion("Escuchando… decí «Lindsy»")
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(1, n)
        }
        if (!activo) iniciar()
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
        activo = true
        esperandoOrden = false
        voz = TextToSpeech(this, this)
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            bloqueo = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lindsy:escucha").apply { acquire() }
        } catch (e: Exception) { }
        silenciarBip(true)
        reiniciar(800)
    }

    private fun silenciarBip(silenciar: Boolean) {
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val dir = if (silenciar) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE
            am.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, dir, 0)
            am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, dir, 0)
        } catch (e: Exception) { }
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

    private fun reiniciar(demora: Long) {
        ui.removeCallbacksAndMessages(null)
        ui.postDelayed({ escuchar() }, demora)
    }

    private fun escuchar() {
        if (!activo) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
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
                override fun onError(error: Int) {
                    val sinVoz = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    if (sinVoz) esperandoOrden = false
                    reiniciar(if (sinVoz) 300L else 2000L)
                }
                override fun onResults(results: Bundle?) {
                    val lista = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
                    val texto = lista.firstOrNull()?.trim().orEmpty()
                    if (texto.isEmpty()) { reiniciar(300); return }
                    if (esperandoOrden) {
                        esperandoOrden = false
                        atender(texto)
                        return
                    }
                    var coincidencia: MatchResult? = null
                    var base = texto
                    for (alt in lista) {
                        val x = palabraClave.find(alt)
                        if (x != null) { coincidencia = x; base = alt; break }
                    }
                    if (coincidencia == null) { reiniciar(200); return }
                    val orden = base.substring(coincidencia.range.last + 1).trim()
                    if (orden.length < 2) {
                        esperandoOrden = true
                        hablar("Sí, decime.") { reiniciar(200) }
                    } else {
                        atender(orden)
                    }
                }
            })
            val intento = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-AR")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
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
                    hablar(respuesta) {
                        esperandoOrden = !termina
                        reiniciar(300)
                    }
                }
            }
        }
    }

    private fun liberar() {
        activo = false
        ui.removeCallbacksAndMessages(null)
        reconocedor?.destroy()
        reconocedor = null
        voz?.stop()
        voz?.shutdown()
        voz = null
        silenciarBip(false)
        try { if (bloqueo?.isHeld == true) bloqueo?.release() } catch (e: Exception) { }
        bloqueo = null
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
