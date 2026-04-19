package com.antigravity.client

import com.intellij.openapi.diagnostic.Logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Kotlin-based client for communicating with the LiteLLM proxy.
 * (Simple implementation using JDK 11+ HttpClient)
 */
class LiteLLMClient(private val baseUrl: String, private val apiKey: String) {
    fun completeSync(modelAlias: String, prompt: String): String {
        val endpoint = "$baseUrl/v1/chat/completions"
        val safePrompt = prompt.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")
        val body = "{\"model\":\"$modelAlias\",\"messages\":[{\"role\":\"user\",\"content\":\"$safePrompt\"}],\"stream\":false}"

        return try {
            val url = java.net.URL(endpoint)
            val connection = url.openConnection() as java.net.HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $apiKey")
            connection.doOutput = true

            val os = connection.outputStream
            os.write(body.toByteArray(java.nio.charset.StandardCharsets.UTF_8))
            os.close()

            val status = connection.responseCode
            val responseText = if (status in 200..299) {
                connection.inputStream.bufferedReader().use { it.readText() }
            } else {
                val errorText = connection.errorStream?.bufferedReader()?.use { it.readText() } ?: "No Error Stream"
                "Error: $status $errorText"
            }
            connection.disconnect()
            responseText
        } catch (e: Exception) {
            "Network Error: ${e.message}"
        }
    }
}
