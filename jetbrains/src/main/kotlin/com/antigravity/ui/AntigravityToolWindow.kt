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
        val toolWindowContent = AntigravityToolWindow(project)
        val content = ContentFactory.getInstance()
            .createContent(toolWindowContent.getContent(), "", false)
        toolWindow.contentManager.addContent(content)
    }
}

class AntigravityToolWindow(private val project: Project) {
    private val mainPanel = JPanel(BorderLayout())
    private val browser = JBCefBrowser()
    private val client = LiteLLMClient("http://localhost:4000", "sk-antigravity")

    init {
        setupBrowser()
        mainPanel.add(browser.component, BorderLayout.CENTER)
    }

    private fun setupBrowser() {
        val router = CefMessageRouter.create()
        router.addHandler(object : CefMessageRouterHandlerAdapter() {
            override fun onQuery(
                browser: CefBrowser?,
                frame: CefFrame?,
                queryId: Long,
                request: String?,
                persistent: Boolean,
                callback: CefQueryCallback?
            ): Boolean {
                if (request == null) return false
                
                // Very simple handle for messages from JS
                // request is a JSON string from chat.js: { type, text, mode, reasoningLevel }
                handleJsMessage(request)
                
                callback?.success("")
                return true
            }
        }, true)

        browser.jbCefClient.addMessageRouter(router)
        
        // Load the chat interface by merging resources into one blob for 100% reliability
        val html = loadMergedHtml()
        browser.loadHTML(html)
    }

    private fun loadMergedHtml(): String {
        // In a production plugin, we use this::class.java.getResourceAsStream(...)
        // For this workspace, we read from the local paths we just established
        val basePath = project.basePath + "/jetbrains/src/main/resources/webview"
        val htmlFile = File("$basePath/chat.html")
        val cssFile = File("$basePath/chat.css")
        val jsFile = File("$basePath/chat.js")

        if (!htmlFile.exists()) return "<html><body><h1>Error</h1><p>Chat UI assets not found at: $basePath</p></body></html>"

        var html = htmlFile.readText()
        val css = if (cssFile.exists()) cssFile.readText() else ""
        val js = if (jsFile.exists()) jsFile.readText() else ""

        // Inject CSS and JS into the HTML
        html = html.replace("<link rel=\"stylesheet\" href=\"chat.css\">", "<style>$css</style>")
        html = html.replace("<script src=\"chat.js\"></script>", "<script>$js</script>")

        return html
    }

    private fun handleJsMessage(json: String) {
        // Extract basic info manually to avoid GSON dependency issues in this environment
        if (json.contains("\"userMessage\"")) {
            val textStart = json.indexOf("\"text\":\"") + 8
            val textEnd = json.indexOf("\"", textStart)
            val prompt = json.substring(textStart, textEnd)

            // For now, solve synchronously and post back to JS
            // In a real version, we would background this and use browser.executeJavaScript()
            Thread {
                val responseJson = client.completeSync("gpt-oss-120b", prompt)
                
                // Extract only the content from the response JSON (LiteLLM format)
                // {"choices":[{"message":{"content":"..."}}]}
                val contentStart = responseJson.indexOf("\"content\":\"") + 11
                val contentEnd = responseJson.indexOf("\"", contentStart)
                val content = if (contentStart > 10) responseJson.substring(contentStart, contentEnd) else "Error: Model response failed"

                // Pass back to Webview
                val js = "window.antigravityReceiveMessage({ \"type\": \"token\", \"content\": \"$content\" });" +
                         "window.antigravityReceiveMessage({ \"type\": \"done\", \"metadata\": { \"agent\": \"Planner\", \"modelLabel\": \"GPT-OSS-120B\", \"confidence\": \"High\", \"modelReason\": \"Local Proxy\" } });"
                
                browser.executeJavaScript(js, browser.cefBrowser.url, 0)
            }.start()
        }
    }

    fun getContent(): JPanel = mainPanel
}
