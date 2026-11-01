package com.nexoai.lindsy

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

class MainActivity : Activity(), TextToSpeech.OnInitListener {
    private val servidor = "https://nexoai-personal.onrender.com"

    private var voz: TextToSpeech? = null
    private var vozLista = false
    private var reconocedor: SpeechRecognizer? = null

    private lateinit var estado: TextView
    private lateinit var charla: TextView
    private lateinit var scroll: ScrollView
    private lateinit var botonHablar: Button
    private lateinit var modoContinuo: Switch

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 40, 32, 32)
        }
        val titulo = TextView(this).apply {
            text = "Lindsy ProMax"
            textSize = 30f
            gravity = Gravity.CENTER
        }
        estado = TextView(this).apply {
            text = "Preparando…"
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 12)
            accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        charla = TextView(this).apply {
            textSize = 18f
            setPadding(8, 8, 8, 8)
        }
        scroll = ScrollView(this).apply { addView(charla) }
        modoContinuo = Switch(this).apply {
            text = "Conversación continua (te vuelve a escuchar sola)"
            setPadding(0, 12, 0, 12)
        }
        botonHablar = Button(this).apply {
            text = "Hablar con Lindsy"
            textSize = 20f
            isEnabled = false
            setOnClickListener { escuchar() }
        }
        val botonClave = Button(this).apply {
            text = "Configurar clave"
            setOnClickListener { pedirClave() }
        }

        raiz.addView(titulo)
        raiz.addView(estado)
        raiz.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        raiz.addView(modoContinuo)
        raiz.addView(botonHablar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        raiz.addView(botonClave, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(raiz)

        voz = TextToSpeech(this, this)
    }

    override fun onInit(resultado: Int) {
        if (resultado == TextToSpeech.SUCCESS) {
            var r = voz?.setLanguage(Locale("es", "AR"))
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                r = voz?.setLanguage(Locale("es"))
            }
            vozLista = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
            voz?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onError(id: String?) { runOnUiThread { terminoDeHablar() } }
                override fun onDone(id: String?) { runOnUiThread { terminoDeHablar() } }
            })
        }
        runOnUiThread {
            if (vozLista) {
                estado.text = if (clave().isBlank()) "Primero tocá «Configurar clave»." else "Lista. Tocá para hablar."
                botonHablar.isEnabled = true
            } else {
                estado.text = "No se pudo iniciar la voz del dispositivo. Revisá el motor de texto a voz."
            }
        }
    }

    private fun clave(): String =
        getSharedPreferences("lindsy", MODE_PRIVATE).getString("clave", "") ?: ""

    private fun pedirClave() {
        val campo = EditText(this).apply {
            hint = "Clave de Lindsy"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(clave())
        }
        AlertDialog.Builder(this)
            .setTitle("Clave de la app")
            .setMessage("Es la misma que está cargada en el servidor (LINDSY_APP_TOKEN).")
            .setView(campo)
            .setPositiveButton("Guardar") { _, _ ->
                getSharedPreferences("lindsy", MODE_PRIVATE).edit()
                    .putString("clave", campo.text.toString().trim()).apply()
                estado.text = "Clave guardada. Tocá para hablar."
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun escuchar() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
            return
        }
        if (clave().isBlank()) {
            pedirClave()
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            estado.text = "Este dispositivo no tiene reconocimiento de voz."
            return
        }
        voz?.stop()
        reconocedor?.destroy()
        reconocedor = SpeechRecognizer.createSpeechRecognizer(this).also { sr ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { estado.text = "Te escucho…" }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { estado.text = "Procesando…" }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onError(error: Int) {
                    val sinVoz = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    estado.text = if (sinVoz) "No te escuché. Tocá para hablar." else "No pude escuchar (código $error)."
                }
                override fun onResults(results: Bundle?) {
                    val texto = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    if (texto.isEmpty()) {
                        estado.text = "No te escuché. Tocá para hablar."
                    } else {
                        enviar(texto)
                    }
                }
            })
            val intento = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-AR")
            }
            sr.startListening(intento)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            escuchar()
        } else {
            estado.text = "Sin permiso de micrófono no puedo escucharte."
        }
    }

    private fun agregar(quien: String, texto: String) {
        charla.append("$quien: $texto\n\n")
        scroll.post { scroll.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun enviar(texto: String) {
        agregar("Vos", texto)
        estado.text = "Lindsy está pensando…"
        val cierre = Regex("^(chau|chao|listo|terminar|nada más|nada mas|gracias lindsy)[.! ]*$", RegexOption.IGNORE_CASE)
        val terminar = cierre.matches(texto)
        thread {
            val respuesta = try {
                consultar(texto)
            } catch (e: Exception) {
                "No pude conectarme con Lindsy. Revisá la conexión a internet."
            }
            runOnUiThread {
                agregar("Lindsy", respuesta)
                if (terminar) modoContinuo.isChecked = false
                hablar(respuesta)
            }
        }
    }

    private fun consultar(texto: String): String {
        val conexion = (URL("$servidor/api/lindsy").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 90000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Bearer " + clave())
        }
        conexion.outputStream.use { it.write(JSONObject().put("texto", texto).toString().toByteArray(Charsets.UTF_8)) }
        val codigo = conexion.responseCode
        val cuerpo = (if (codigo < 400) conexion.inputStream else conexion.errorStream)
            ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val json = try { JSONObject(cuerpo) } catch (e: Exception) { JSONObject() }
        return when {
            codigo == 200 -> json.optString("respuesta", "No entendí la respuesta del servidor.")
            codigo == 401 -> "La clave es incorrecta. Tocá Configurar clave."
            else -> json.optString("error", "El servidor respondió con el error $codigo.")
        }
    }

    private fun hablar(texto: String) {
        if (vozLista) {
            estado.text = "Lindsy habla…"
            voz?.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "lindsy")
        } else {
            terminoDeHablar()
        }
    }

    private fun terminoDeHablar() {
        if (modoContinuo.isChecked) {
            escuchar()
        } else {
            estado.text = "Tocá para hablar."
        }
    }

    override fun onDestroy() {
        reconocedor?.destroy()
        voz?.stop()
        voz?.shutdown()
        super.onDestroy()
    }
}
