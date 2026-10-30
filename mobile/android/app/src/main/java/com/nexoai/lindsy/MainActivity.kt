package com.nexoai.lindsy

import android.app.Activity
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

class MainActivity : Activity(), TextToSpeech.OnInitListener {
    private var speaker: TextToSpeech? = null
    private var speakerReady = false
    private lateinit var status: TextView
    private lateinit var speakButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 48, 32, 48)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val title = TextView(this).apply {
            text = "Lindsy ProMax"
            textSize = 30f
            gravity = Gravity.CENTER
            contentDescription = "Lindsy ProMax, asistente personal"
        }

        val subtitle = TextView(this).apply {
            text = "Tu asistente, en el teléfono y la tablet"
            textSize = 17f
            gravity = Gravity.CENTER
            setPadding(0, 20, 0, 28)
        }

        status = TextView(this).apply {
            text = "Preparando la voz del dispositivo…"
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 24)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }

        speakButton = Button(this).apply {
            text = "Probar la voz de Lindsy"
            isEnabled = false
            contentDescription = "Reproducir saludo de prueba de Lindsy"
            setOnClickListener {
                speaker?.speak(
                    "Hola. Soy Lindsy, tu asistente personal. Ya estoy preparada para comenzar.",
                    TextToSpeech.QUEUE_FLUSH,
                    null,
                    "lindsy-greeting"
                )
            }
        }

        layout.addView(title)
        layout.addView(subtitle)
        layout.addView(status)
        layout.addView(
            speakButton,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )
        setContentView(layout)

        speaker = TextToSpeech(this, this)
    }

    override fun onInit(result: Int) {
        if (result == TextToSpeech.SUCCESS) {
            val languageResult = speaker?.setLanguage(Locale("es", "AR"))
            speakerReady = languageResult != TextToSpeech.LANG_MISSING_DATA &&
                languageResult != TextToSpeech.LANG_NOT_SUPPORTED
            if (!speakerReady) {
                speaker?.setLanguage(Locale("es"))
                speakerReady = true
            }
        }

        runOnUiThread {
            if (speakerReady) {
                status.text = "Voz del dispositivo lista. Esta versión todavía no escucha el micrófono."
                speakButton.isEnabled = true
            } else {
                status.text = "No se pudo inicializar la voz. Revisá el motor de texto a voz del dispositivo."
                speakButton.isEnabled = false
            }
        }
    }

    override fun onDestroy() {
        speaker?.stop()
        speaker?.shutdown()
        speaker = null
        super.onDestroy()
    }
}
