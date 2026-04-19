package com.antigravity.ui

import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.ui.jcef.JBCefBrowserBase
import java.awt.BorderLayout
import javax.swing.JPanel
import com.antigravity.client.LiteLLMClient

class KairosBrowserPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val browser = JBCefBrowser()
    private val jsQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val client = LiteLLMClient(
        System.getenv("LITELLM_BASE_URL") ?: System.getenv("KAIROS_LITELLM_BASE_URL") ?: "http://localhost:4000",
        System.getenv("LITELLM_MASTER_KEY") ?: System.getenv("KAIROS_LITELLM_API_KEY") ?: "sk-KAIROS"
    )

    init {
        jsQuery.addHandler { jsonRequest ->
            println("Kairos JetBrains Received: " + jsonRequest)
            handleJsMessage(jsonRequest)
            null
        }

        try {
            val htmlStream = this::class.java.getResourceAsStream("/webview/chat.html")
            val cssStream = this::class.java.getResourceAsStream("/webview/chat.css")
            val jsStream = this::class.java.getResourceAsStream("/webview/chat.js")

            if (htmlStream != null) {
                var html = String(htmlStream.readAllBytes())
                val css = if (cssStream != null) String(cssStream.readAllBytes()) else ""
                val js = if (jsStream != null) String(jsStream.readAllBytes()) else ""

                val vscodeShim = """
                    <script nonce="jetbrains">
                    window.acquireVsCodeApi = function() {
                        return {
                            postMessage: function(msg) {
                                ${jsQuery.inject("JSON.stringify(msg)")}
                            }
                        };
                    };
                    window.antigravityReceiveMessage = function(msg) {
                        window.dispatchEvent(new MessageEvent('message', { data: msg }));
                    };
                    </script>
                """.trimIndent()

                html = html.replace("<link rel=\"stylesheet\" href=\"\${cssUri}\">", "<style>\n" + css + "\n</style>")
                html = html.replace("<script nonce=\"\${nonce}\" src=\"\${jsUri}\"></script>", vscodeShim + "\n<script nonce=\"jetbrains\">\n" + js + "\n</script>")
                html = html.replace("\${nonce}", "jetbrains")

                // Load with dummy URL to allow internal routing if necessary
                browser.loadHTML(html, "http://localhost/chat.html")
            } else {
                browser.loadHTML("<html><body><h1>Error</h1><p>Chat UI assets not found in /webview/ resources</p></body></html>")
            }
        } catch (e: Exception) {
            browser.loadHTML("<html><body><h1>Exception</h1><pre>" + e.message + "</pre></body></html>")
        }

        add(browser.component, BorderLayout.CENTER)
        
        // Open DevTools automatically to debug UI JS issues
        browser.openDevtools()
    }

    private fun handleJsMessage(json: String) {
        if (json.contains("\"userMessage\"") || json.contains("\"command\"")) {
            val textMatch = Regex("\"text\"\\s*:\\s*\"(.*?)\"").find(json)
            val modelMatch = Regex("\"model\"\\s*:\\s*\"(.*?)\"").find(json)
            
            val prompt = textMatch?.groups?.get(1)?.value ?: "hi"
            var selectedModel = modelMatch?.groups?.get(1)?.value ?: "deepseek-r1-8b"

            // Handle the 'auto' dropdown value or missing data
            if (selectedModel == "auto" || selectedModel == "None" || selectedModel.isEmpty()) {
                selectedModel = "deepseek-r1-8b"
            }

            Thread {
                try {
                    val responseJson = client.completeSync(selectedModel, prompt)
                    
                    var display = ""
                    if (responseJson.contains("\"content\":\"")) {
                         val start = responseJson.indexOf("\"content\":\"") + 11
                         var end = start
                         while(end < responseJson.length) {
                             if(responseJson[end] == '"' && responseJson[end-1] != '\\') break
                             end++
                         }
                         display = if (end > start) responseJson.substring(start, end) else responseJson
                    } else {
                         display = responseJson
                    }

                    // Replace escaped characters for UI rendering
                    val finalContent = display.replace("\\n", "\n").replace("\\\"", "\"")
                    
                    val safeContent = finalContent.replace("'", "\\'").replace("\n", "\\n")
                    val js = "window.antigravityReceiveMessage({ \"type\": \"token\", \"content\": '$safeContent' });" +
                             "window.antigravityReceiveMessage({ \"type\": \"done\", \"metadata\": { \"agent\": \"Planner\", \"modelLabel\": \"" + selectedModel.uppercase() + "\", \"confidence\": \"High\", \"modelReason\": \"JetBrains Universal\" } });"
                    
                    browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
                } catch (e: Exception) {
                    val js = "window.antigravityReceiveMessage({ \"type\": \"token\", \"content\": 'Internal Exception: " + e.message + "' });" +
                             "window.antigravityReceiveMessage({ \"type\": \"done\" });"
                    browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
                }
            }.start()
        }
    }
}


