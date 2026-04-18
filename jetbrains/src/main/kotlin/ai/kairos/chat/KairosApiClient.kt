package ai.kairos.chat

import ai.kairos.settings.KairosSettings
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.swing.SwingUtilities

class KairosApiClient {

  private val client = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(120, TimeUnit.SECONDS)
    .build()

  private var activeCall: Call? = null

  fun cancelCurrentCall() {
    activeCall?.cancel()
    activeCall = null
  }

  fun sendMessage(
    messages: List<Map<String, String>>,
    onToken: (String) -> Unit,
    onDone: () -> Unit,
    onError: (String) -> Unit
  ) {
    val settings = KairosSettings.getInstance().state

    val body = JSONObject().apply {
      put("model", settings.selectedModel)
      put("stream", settings.streamingEnabled)
      put("messages", JSONArray().apply {
        messages.forEach { msg ->
          put(JSONObject().apply {
            put("role", msg["role"])
            put("content", msg["content"])
          })
        }
      })
    }

    val request = Request.Builder()
      .url("${settings.proxyUrl}/v1/chat/completions")
      .header("Authorization", "Bearer ${settings.apiKey}")
      .header("Content-Type", "application/json")
      .post(body.toString().toRequestBody("application/json".toMediaType()))
      .build()

    activeCall = client.newCall(request)

    activeCall!!.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        if (call.isCanceled()) {
          SwingUtilities.invokeLater { onDone() }
        } else {
          SwingUtilities.invokeLater { onError(e.message ?: "Connection failed") }
        }
      }

      override fun onResponse(call: Call, response: Response) {
        if (!response.isSuccessful) {
          SwingUtilities.invokeLater {
            onError("Error ${response.code}: ${response.body?.string()}")
          }
          return
        }

        response.body?.source()?.let { source ->
          try {
            while (!source.exhausted()) {
              val line = source.readUtf8Line() ?: break
              if (line.startsWith("data: ")) {
                val data = line.removePrefix("data: ").trim()
                if (data == "[DONE]") break
                try {
                  val json   = JSONObject(data)
                  val delta  = json
                    .getJSONArray("choices")
                    .getJSONObject(0)
                    .getJSONObject("delta")
                  val token = delta.optString("content", "")
                  if (token.isNotEmpty()) {
                    SwingUtilities.invokeLater { onToken(token) }
                  }
                } catch (_: Exception) {}
              }
            }
          } catch (e: IOException) {
            if (!call.isCanceled()) {
              SwingUtilities.invokeLater { onError(e.message ?: "Stream error") }
            }
          } finally {
            SwingUtilities.invokeLater { onDone() }
          }
        }
      }
    })
  }
}
