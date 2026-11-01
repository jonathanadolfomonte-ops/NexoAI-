plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.nexoai.lindsy"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.nexoai.lindsy"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "0.2.1"
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
