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
    private val client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(1000))
        .build()

    fun completeSync(modelAlias: String, prompt: String): String {
        val endpoint = "$baseUrl/v1/chat/completions"
        val body = """{
            "model": "$modelAlias",
            "messages": [{"role": "user", "content": "$prompt"}],
            "stream": false
        }""".trimIndent()

        val request = HttpRequest.newBuilder()
            .uri(URI.create(endpoint))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $apiKey")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()

        return try {
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() != 200) {
                "Error: ${response.statusCode()} ${response.body()}"
            } else {
                response.body()
            }
        } catch (e: Exception) {
            "Network Error: ${e.message}"
        }
    }
}
