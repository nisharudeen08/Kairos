package com.antigravity.ui

import com.antigravity.client.LiteLLMClient
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefQueryCallback
import org.cef.handler.CefMessageRouterHandlerAdapter
import org.cef.browser.CefMessageRouter
import java.awt.BorderLayout
import java.io.File
import javax.swing.JPanel

class AntigravityToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = KairosBrowserPanel(project)
        val content = ContentFactory.getInstance()
            .createContent(panel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}

class AntigravityToolWindow(private val project: Project) {
    private val mainPanel = JPanel(BorderLayout())
    private val browser = JBCefBrowser()
    private val client = LiteLLMClient(
        System.getenv("LITELLM_BASE_URL") ?: System.getenv("KAIROS_LITELLM_BASE_URL") ?: "https://kairos-litellm.onrender.com",
        System.getenv("LITELLM_MASTER_KEY") ?: System.getenv("KAIROS_LITELLM_API_KEY") ?: "sk-KAIROS"
    )

    private val jsQuery = com.intellij.ui.jcef.JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase)

    init {
        setupBrowser()
        mainPanel.add(browser.component, BorderLayout.CENTER)
    }

    private fun setupBrowser() {
        jsQuery.addHandler { request ->
            if (request != null) {
                handleJsMessage(request)
            }
            null
        }

        browser.jbCefClient.addLoadHandler(object : org.cef.handler.CefLoadHandlerAdapter() {
            override fun onLoadStart(browser: CefBrowser?, frame: CefFrame?, transitionType: org.cef.network.CefRequest.TransitionType?) {
                val shim = """
                    window.cefQuery = function(req) {
                        ${jsQuery.inject("req.request")}
                    };
                """.trimIndent()
                browser?.executeJavaScript(shim, frame?.url, 0)
            }
        }, browser.cefBrowser)
        
        // Load the chat interface by merging resources into one blob for 100% reliability
        val html = loadMergedHtml()
        browser.loadHTML(html)
    }

    private fun loadMergedHtml(): String {
        // In a production plugin, we use this::class.java.getResourceAsStream(...)
        // Since we are loading from the project directly, let's point to the real vscode files
        val projectRoot = project.basePath ?: ""
        var basePath = "$projectRoot/vscode/media"
        var htmlFile = File("$basePath/chat.html")
        
        if (!htmlFile.exists()) {
            basePath = "$projectRoot/../vscode/media"
            htmlFile = File("$basePath/chat.html")
        }
        
        val cssFile = File("$basePath/chat.css")
        val jsFile = File("$basePath/chat.js")

        if (!htmlFile.exists()) return "<html><body><h1>Error</h1><p>Chat UI assets not found at: $basePath</p></body></html>"

        var html = htmlFile.readText()
        val css = if (cssFile.exists()) cssFile.readText() else ""
        val js = if (jsFile.exists()) jsFile.readText() else ""

        // Universal Shim to mock VS Code API in JetBrains
        val vscodeShim = """
            <script>
            window.acquireVsCodeApi = function() {
                return {
                    postMessage: function(message) {
                        if (window.cefQuery) {
                            window.cefQuery({
                                request: JSON.stringify(message),
                                onSuccess: function(response) {},
                                onFailure: function(error_code, error_message) {}
                            });
                        }
                    }
                };
            };
            window.antigravityReceiveMessage = function(msg) {
                window.dispatchEvent(new MessageEvent('message', { data: msg }));
            };
            </script>
        """.trimIndent()

        // Inject CSS and JS into the HTML using exact VS Code placeholders
        html = html.replace("<link rel=\"stylesheet\" href=\"\${cssUri}\">", "<style>\$css</style>")
        html = html.replace("<script nonce=\"\${nonce}\" src=\"\${jsUri}\"></script>", "\$vscodeShim\n<script>\$js</script>")
        html = html.replace("\${nonce}", "jetbrains")
        
        return html
    }

    private fun handleJsMessage(json: String) {
        // Extract basic info manually to avoid GSON dependency issues in this environment
        if (json.contains("\"userMessage\"")) {
            val textStart = json.indexOf("\"text\":\"") + 8
            val textEnd = json.indexOf("\"", textStart)
            val prompt = json.substring(textStart, textEnd)

            val modelStart = json.indexOf("\"model\":\"") + 9
            val modelEnd = json.indexOf("\"", modelStart)
            val selectedModel = if (modelStart > 8) json.substring(modelStart, modelEnd) else "gpt-oss-120b"

            // For now, solve synchronously and post back to JS
            // In a real version, we would background this and use browser.executeJavaScript()
            Thread {
                val responseJson = client.completeSync(selectedModel, prompt)
                
                // Extract only the content from the response JSON (LiteLLM format)
                // {"choices":[{"message":{"content":"..."}}]}
                val contentStart = responseJson.indexOf("\"content\":\"") + 11
                val contentEnd = responseJson.indexOf("\"", contentStart)
                val content = if (contentStart > 10) responseJson.substring(contentStart, contentEnd) else "Error: Model response failed"

                // Pass back to Webview
                val js = "window.antigravityReceiveMessage({ \"type\": \"token\", \"content\": \"$content\" });" +
                         "window.antigravityReceiveMessage({ \"type\": \"done\", \"metadata\": { \"agent\": \"Planner\", \"modelLabel\": \"${selectedModel.uppercase()}\", \"confidence\": \"High\", \"modelReason\": \"Local Proxy\" } });"
                
                browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
            }.start()
        }
    }

    fun getContent(): JPanel = mainPanel
}
