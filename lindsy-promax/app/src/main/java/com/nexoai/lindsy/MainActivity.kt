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
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import org.json.JSONArray
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

    private lateinit var contenedor: FrameLayout
    private var pantalla = "inicio"

    // Micro app: charla
    private var estado: TextView? = null
    private var charla: TextView? = null
    private var scroll: ScrollView? = null
    private var botonHablar: Button? = null
    private var modoContinuo: Switch? = null

    // Micro app: modo escucha (palabra de activacion "Lindsy")
    private var escuchaActiva = false
    private var esperandoOrden = false
    private val ciclo = android.os.Handler(android.os.Looper.getMainLooper())
    private val palabraClave = Regex("""\b(lindsy|lindsi|lindsay|lindsey|linchi|linsi|lindi)\b[,.!?]*\s*""", RegexOption.IGNORE_CASE)
    private val palabraCierre = Regex("""^(chau|chao|listo|terminar|nada más|nada mas|gracias lindsy|gracias)[.! ]*$""", RegexOption.IGNORE_CASE)

    // Micro app: agenda
    private var listaAgenda: LinearLayout? = null
    private var estadoAgenda: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        contenedor = FrameLayout(this)
        setContentView(contenedor)
        voz = TextToSpeech(this, this)
        mostrarInicio()
    }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density).toInt()

    private fun columna(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(24), dp(16), dp(16))
    }

    private fun mostrar(vista: View) {
        contenedor.removeAllViews()
        contenedor.addView(vista, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun titulo(texto: String): TextView = TextView(this).apply {
        text = texto
        textSize = 28f
        gravity = Gravity.CENTER
        setPadding(0, 0, 0, dp(8))
    }

    private fun botonGrande(texto: String, accion: () -> Unit): Button = Button(this).apply {
        text = texto
        textSize = 20f
        isAllCaps = false
        setPadding(dp(16), dp(20), dp(16), dp(20))
        setOnClickListener { accion() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(0, dp(8), 0, dp(8))
        }
    }

    override fun onBackPressed() {
        if (pantalla != "inicio") mostrarInicio() else super.onBackPressed()
    }

    // ---------------- Inicio ----------------
    private fun mostrarInicio() {
        pantalla = "inicio"
        detenerVozYMicro()
        val raiz = columna()
        raiz.addView(titulo("Lindsy ProMax"))
        raiz.addView(TextView(this).apply {
            text = "Tus micro apps"
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(16))
        })
        raiz.addView(botonGrande("🎤  Hablar con Lindsy") { mostrarCharla() })
        raiz.addView(botonGrande("📅  Agenda") { mostrarAgenda() })
        raiz.addView(botonGrande("👂  Modo escucha (decí «Lindsy»)") { mostrarEscucha() })
        raiz.addView(botonGrande("📝  Notas (próximamente)") {}.apply { isEnabled = false })
        raiz.addView(botonGrande("🔑  Clave de acceso") { pedirClave() }.apply { textSize = 16f })
        mostrar(ScrollView(this).apply { addView(raiz) })
    }

    private fun detenerVozYMicro() {
        escuchaActiva = false
        esperandoOrden = false
        ciclo.removeCallbacksAndMessages(null)
        window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        voz?.stop()
        reconocedor?.destroy()
        reconocedor = null
    }

    private fun volverBoton(): Button = Button(this).apply {
        text = "← Volver"
        isAllCaps = false
        setOnClickListener { mostrarInicio() }
    }

    // ---------------- Clave ----------------
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
                estado?.text = "Clave guardada."
                estadoAgenda?.text = "Clave guardada."
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // ---------------- Red ----------------
    private fun pedir(metodo: String, ruta: String, cuerpo: JSONObject?): Pair<Int, JSONObject> {
        val c = (URL(servidor + ruta).openConnection() as HttpURLConnection).apply {
            requestMethod = metodo
            connectTimeout = 15000
            readTimeout = 90000
            setRequestProperty("Authorization", "Bearer " + clave())
            if (cuerpo != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
        if (cuerpo != null) c.outputStream.use { it.write(cuerpo.toString().toByteArray(Charsets.UTF_8)) }
        val codigo = c.responseCode
        val texto = (if (codigo < 400) c.inputStream else c.errorStream)
            ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val json = try { JSONObject(texto) } catch (e: Exception) { JSONObject() }
        return Pair(codigo, json)
    }

    private fun mensajeError(r: Pair<Int, JSONObject>): String = when (r.first) {
        401 -> "La clave es incorrecta. Revisala en «Clave de acceso»."
        503 -> "El servidor todavía no tiene habilitada la app."
        else -> r.second.optString("error", "El servidor respondió con el error ${r.first}.")
    }

    // ---------------- Voz del dispositivo ----------------
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
            if (pantalla == "charla") {
                estado?.text = if (vozLista) "Lista. Tocá para hablar." else "No se pudo iniciar la voz del dispositivo."
                botonHablar?.isEnabled = vozLista
            }
        }
    }

    // ---------------- Micro app: Charla ----------------
    private fun mostrarCharla() {
        pantalla = "charla"
        val raiz = columna()
        raiz.addView(volverBoton())
        raiz.addView(titulo("Hablar con Lindsy"))
        estado = TextView(this).apply {
            text = if (vozLista) "Lista. Tocá para hablar." else "Preparando la voz…"
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(8))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        charla = TextView(this).apply {
            textSize = 18f
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        scroll = ScrollView(this).apply { addView(charla) }
        modoContinuo = Switch(this).apply {
            text = "Conversación continua (te vuelve a escuchar sola)"
            setPadding(0, dp(12), 0, dp(12))
        }
        botonHablar = Button(this).apply {
            text = "Hablar con Lindsy"
            textSize = 20f
            isEnabled = vozLista
            setOnClickListener { escuchar() }
        }
        raiz.addView(estado)
        raiz.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        raiz.addView(modoContinuo)
        raiz.addView(botonHablar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        mostrar(raiz)
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
            estado?.text = "Este dispositivo no tiene reconocimiento de voz."
            return
        }
        voz?.stop()
        reconocedor?.destroy()
        reconocedor = SpeechRecognizer.createSpeechRecognizer(this).also { sr ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { estado?.text = "Te escucho…" }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() { estado?.text = "Procesando…" }
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onError(error: Int) {
                    val sinVoz = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    estado?.text = if (sinVoz) "No te escuché. Tocá para hablar." else "No pude escuchar (código $error)."
                }
                override fun onResults(results: Bundle?) {
                    val texto = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    if (texto.isEmpty()) estado?.text = "No te escuché. Tocá para hablar." else enviar(texto)
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
        if (requestCode == 2 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            iniciarEscucha()
        } else if (requestCode == 1 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            escuchar()
        } else {
            estado?.text = "Sin permiso de micrófono no puedo escucharte."
        }
    }

    private fun agregar(quien: String, texto: String) {
        charla?.append("$quien: $texto\n\n")
        scroll?.post { scroll?.fullScroll(ScrollView.FOCUS_DOWN) }
    }

    private fun enviar(texto: String) {
        agregar("Vos", texto)
        estado?.text = "Lindsy está pensando…"
        val cierre = Regex("^(chau|chao|listo|terminar|nada más|nada mas|gracias lindsy)[.! ]*$", RegexOption.IGNORE_CASE)
        val terminar = cierre.matches(texto)
        thread {
            val respuesta = try {
                val r = pedir("POST", "/api/lindsy", JSONObject().put("texto", texto))
                if (r.first == 200) r.second.optString("respuesta", "No entendí la respuesta del servidor.") else mensajeError(r)
            } catch (e: Exception) {
                "No pude conectarme con Lindsy. Revisá la conexión a internet."
            }
            runOnUiThread {
                if (pantalla != "charla") return@runOnUiThread
                agregar("Lindsy", respuesta)
                if (terminar) modoContinuo?.isChecked = false
                hablar(respuesta)
            }
        }
    }

    private fun hablar(texto: String) {
        if (vozLista) {
            estado?.text = "Lindsy habla…"
            voz?.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "lindsy")
        } else {
            terminoDeHablar()
        }
    }

    private fun terminoDeHablar() {
        if (pantalla == "escucha") {
            if (escuchaActiva) reiniciarEscucha(400)
            return
        }
        if (pantalla != "charla") return
        if (modoContinuo?.isChecked == true) escuchar() else estado?.text = "Tocá para hablar."
    }

    // ---------------- Micro app: Modo escucha ----------------
    private fun mostrarEscucha() {
        pantalla = "escucha"
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val raiz = columna()
        raiz.addView(volverBoton())
        raiz.addView(titulo("Modo escucha"))
        estado = TextView(this).apply {
            text = "Preparando…"
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(8))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        charla = TextView(this).apply {
            textSize = 18f
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        scroll = ScrollView(this).apply { addView(charla) }
        botonHablar = Button(this).apply {
            text = "Pausar escucha"
            textSize = 20f
            isAllCaps = false
            setOnClickListener {
                if (escuchaActiva) {
                    escuchaActiva = false
                    esperandoOrden = false
                    ciclo.removeCallbacksAndMessages(null)
                    reconocedor?.destroy()
                    reconocedor = null
                    voz?.stop()
                    estado?.text = "Escucha en pausa."
                    text = "Reanudar escucha"
                } else {
                    text = "Pausar escucha"
                    iniciarEscucha()
                }
            }
        }
        raiz.addView(estado)
        raiz.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        raiz.addView(botonHablar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        mostrar(raiz)
        iniciarEscucha()
    }

    private fun iniciarEscucha() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2)
            return
        }
        if (clave().isBlank()) {
            estado?.text = "Primero cargá la clave en «Clave de acceso»."
            pedirClave()
            return
        }
        escuchaActiva = true
        esperandoOrden = false
        reiniciarEscucha(200)
    }

    private fun reiniciarEscucha(demora: Long) {
        ciclo.removeCallbacksAndMessages(null)
        ciclo.postDelayed({ escucharPalabra() }, demora)
    }

    private fun escucharPalabra() {
        if (!escuchaActiva || pantalla != "escucha") return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            estado?.text = "Este dispositivo no tiene reconocimiento de voz."
            return
        }
        reconocedor?.destroy()
        reconocedor = SpeechRecognizer.createSpeechRecognizer(this).also { sr ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    estado?.text = if (esperandoOrden) "Te escucho, decime…" else "Escuchando… decí «Lindsy»"
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onError(error: Int) {
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        escuchaActiva = false
                        estado?.text = "Sin permiso de micrófono."
                        return
                    }
                    val sinVoz = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                    if (sinVoz) esperandoOrden = false
                    reiniciarEscucha(if (sinVoz) 300L else 1500L)
                }
                override fun onResults(results: Bundle?) {
                    val texto = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()?.trim().orEmpty()
                    if (texto.isEmpty()) { reiniciarEscucha(300); return }
                    if (esperandoOrden) {
                        esperandoOrden = false
                        atenderOrden(texto)
                        return
                    }
                    val m = palabraClave.find(texto)
                    if (m == null) { reiniciarEscucha(200); return }
                    val orden = texto.substring(m.range.last + 1).trim()
                    if (orden.length < 2) {
                        esperandoOrden = true
                        agregar("Lindsy", "Sí, decime.")
                        hablar("Sí, decime.")
                    } else {
                        atenderOrden(orden)
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

    private fun atenderOrden(orden: String) {
        agregar("Vos", orden)
        estado?.text = "Lindsy está pensando…"
        val terminar = palabraCierre.matches(orden)
        thread {
            val respuesta = try {
                val r = pedir("POST", "/api/lindsy", JSONObject().put("texto", orden))
                if (r.first == 200) r.second.optString("respuesta", "No entendí la respuesta del servidor.") else mensajeError(r)
            } catch (e: Exception) {
                "No pude conectarme con Lindsy. Revisá la conexión a internet."
            }
            runOnUiThread {
                if (pantalla != "escucha" || !escuchaActiva) return@runOnUiThread
                agregar("Lindsy", respuesta)
                esperandoOrden = !terminar
                hablar(respuesta)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (pantalla == "escucha") {
            ciclo.removeCallbacksAndMessages(null)
            reconocedor?.destroy()
            reconocedor = null
            voz?.stop()
        }
    }

    override fun onResume() {
        super.onResume()
        if (pantalla == "escucha" && escuchaActiva) reiniciarEscucha(500)
    }

    // ---------------- Micro app: Agenda ----------------
    private fun mostrarAgenda() {
        pantalla = "agenda"
        val raiz = columna()
        raiz.addView(volverBoton())
        raiz.addView(titulo("Agenda"))
        val campo = EditText(this).apply {
            hint = "Ej: dentista mañana a las 15:30"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setSingleLine()
        }
        val botonAnotar = Button(this).apply {
            text = "Anotar"
            isAllCaps = false
        }
        estadoAgenda = TextView(this).apply {
            textSize = 15f
            setPadding(0, dp(8), 0, dp(8))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        listaAgenda = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        botonAnotar.setOnClickListener {
            val t = campo.text.toString().trim()
            if (t.isEmpty()) return@setOnClickListener
            campo.setText("")
            estadoAgenda?.text = "Anotando…"
            thread {
                val r = try { pedir("POST", "/api/agenda", JSONObject().put("texto", t)) } catch (e: Exception) { null }
                runOnUiThread {
                    if (pantalla != "agenda") return@runOnUiThread
                    if (r == null) { estadoAgenda?.text = "No pude conectarme. Revisá internet."; return@runOnUiThread }
                    pintarAgenda(r)
                    if (r.first == 200) estadoAgenda?.text = r.second.optString("respuesta", "Anotado.")
                }
            }
        }
        raiz.addView(campo)
        raiz.addView(botonAnotar)
        raiz.addView(estadoAgenda)
        raiz.addView(ScrollView(this).apply { addView(listaAgenda) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        mostrar(raiz)
        cargarAgenda()
    }

    private fun cargarAgenda() {
        if (clave().isBlank()) { estadoAgenda?.text = "Primero cargá la clave en «Clave de acceso»."; return }
        estadoAgenda?.text = "Cargando… (si el servidor dormía, puede tardar hasta 1 minuto)"
        thread {
            val r = try { pedir("GET", "/api/agenda", null) } catch (e: Exception) { null }
            runOnUiThread {
                if (pantalla != "agenda") return@runOnUiThread
                if (r == null) estadoAgenda?.text = "No pude conectarme. Revisá internet." else pintarAgenda(r)
            }
        }
    }

    private fun pintarAgenda(r: Pair<Int, JSONObject>) {
        if (r.first != 200) { estadoAgenda?.text = mensajeError(r); return }
        val lista = listaAgenda ?: return
        val items: JSONArray = r.second.optJSONArray("items") ?: JSONArray()
        lista.removeAllViews()
        estadoAgenda?.text = if (items.length() == 0) "No tenés nada anotado." else "Pendientes: ${items.length()}"
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            val id = it.getInt("id")
            val cuando = it.optString("cuando", "")
            val fila = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, dp(6))
            }
            fila.addView(TextView(this).apply {
                text = it.optString("texto") + if (cuando.isNotEmpty()) "\n$cuando" else ""
                textSize = 18f
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            fila.addView(Button(this).apply {
                text = "Borrar"
                isAllCaps = false
                setOnClickListener {
                    isEnabled = false
                    thread {
                        val rr = try { pedir("DELETE", "/api/agenda/$id", null) } catch (e: Exception) { null }
                        runOnUiThread {
                            if (pantalla != "agenda") return@runOnUiThread
                            if (rr == null) { isEnabled = true; estadoAgenda?.text = "No pude conectarme." } else pintarAgenda(rr)
                        }
                    }
                }
            })
            lista.addView(fila)
        }
    }

    override fun onDestroy() {
        reconocedor?.destroy()
        voz?.stop()
        voz?.shutdown()
        super.onDestroy()
    }
}
