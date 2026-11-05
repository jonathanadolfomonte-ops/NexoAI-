plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.nexoai.lindsy"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.nexoai.lindsy.promax"
        minSdk = 24
        targetSdk = 34
        versionCode = 8
        versionName = "0.5.0"
    }
    signingConfigs {
        getByName("debug") {
            storeFile = file("lindsy.p12")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
            storeType = "pkcs12"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("ai.picovoice:porcupine-android:4.0.2")
}
