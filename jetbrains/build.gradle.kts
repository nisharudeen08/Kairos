plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
  id("org.jetbrains.intellij") version "1.17.4"
}

group = "ai.kairos"
version = "1.0.0"

repositories { mavenCentral() }

intellij {
  version.set("2023.3")
  type.set("IC")              // IC = IntelliJ Community, works for all JB IDEs
  plugins.set(listOf())
}

dependencies {
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("org.json:json:20240303")
}

tasks {
  withType<JavaCompile> {
    sourceCompatibility = "17"
    targetCompatibility = "17"
  }
  withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
    kotlinOptions.jvmTarget = "17"
  }
  patchPluginXml {
    sinceBuild.set("231")
    untilBuild.set("261.*")
  }
  signPlugin {
    certificateChain.set(System.getenv("CERTIFICATE_CHAIN") ?: "")
    privateKey.set(System.getenv("PRIVATE_KEY") ?: "")
    password.set(System.getenv("PRIVATE_KEY_PASSWORD") ?: "")
  }
  publishPlugin {
    token.set(System.getenv("PUBLISH_TOKEN") ?: "")
  }
}
