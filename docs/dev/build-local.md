# Build Dev local (sin EAS)

Para cuando haya cambios nativos frecuentes. EAS tarda ~25 min con cola; local, el primero tarda
15–20 min y los siguientes 2–5 min (Gradle reutiliza lo compilado). Los cambios de JavaScript no
necesitan build: Metro los recarga.

**Dónde:** en la K16 (Ryzen 7 7735HS, 8 núcleos; el teléfono se conecta acá). La Z440 compila más lento
(Xeon de 4 núcleos, 2016); la GPU no interviene en un build de Android. Gradle usa 4–6 GB de RAM:
cerrar lo pesado antes. Todo se instala en el usuario, sin sudo (~15 GB).

Versiones que pide React Native 0.85 (`node_modules/react-native/gradle/libs.versions.toml`, revisar
al actualizar Expo): compileSdk/targetSdk **36**, build-tools **36.0.0**, NDK **27.1.12297006**, JDK **17**.

## 1. Instalar una sola vez

```bash
# JDK 17 (Temurin)
mkdir -p ~/opt && cd ~/opt
curl -L -o jdk17.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
tar xzf jdk17.tar.gz && rm jdk17.tar.gz && ln -sfn ~/opt/jdk-17* ~/opt/jdk17

# Android SDK: herramientas de línea de comandos
mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
curl -L -o tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip"
unzip -q tools.zip && rm tools.zip && mv cmdline-tools latest

# Variables (agregarlas también a ~/.bashrc)
export JAVA_HOME=~/opt/jdk17
export ANDROID_HOME=~/Android/Sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# Paquetes del SDK (acepta licencias)
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```

Si la versión de `commandlinetools` cambió, la vigente está en
https://developer.android.com/studio#command-line-tools-only. `adb` ya está en el sistema
(`/usr/bin/adb`); el de `platform-tools` sirve igual.

## 2. Compilar el build Dev

```bash
cd ~/src/OBDient2
# Genera android/ desde app.json + app.config.ts (no va al repo: está en .gitignore).
# --clean la regenera de cero: usarlo después de cambiar plugins o dependencias nativas.
APP_VARIANT=development npx expo prebuild --platform android --clean

cd android
# Menos memoria para que entre con Metro abierto (14 GB en la K16)
./gradlew assembleDebug -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Firma: el build local usa la clave de depuración de Android, no la de EAS. Para Magic no importa (el
allowlist es por identificador de app, `com.obdient.obdient2.dev`).

## 3. Instalar y abrir por cable (túnel USB, no wifi)

```bash
adb devices                                   # el teléfono tiene que aparecer como "device"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081                 # el puerto 8081 del teléfono va a Metro en la PC
APP_VARIANT=development npx expo start --dev-client --port 8081 --localhost   # en otra terminal
adb shell am start -a android.intent.action.VIEW \
  -d "obdient2-dev://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.obdient.obdient2.dev
```

Si un APK de EAS ya está instalado con la misma app, Android rechaza el de depuración (firma distinta):
`adb uninstall com.obdient.obdient2.dev` antes (se pierden los datos de la app: cuenta, historial).

## 4. Builds siguientes

```bash
cd ~/src/OBDient2/android && ./gradlew assembleDebug -Dorg.gradle.jvmargs="-Xmx4g"
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Solo hace falta `prebuild --clean` de nuevo si cambió `app.json`, `app.config.ts` o una dependencia
nativa.
