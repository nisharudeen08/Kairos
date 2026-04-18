package com.antigravity.ui

import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.ui.jcef.JBCefBrowserBase
import java.awt.BorderLayout
import java.nio.file.Paths
import javax.swing.JPanel
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter

class KairosBrowserPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val browser = JBCefBrowser()
    private val jsQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)

    init {
        val projectRoot = project.basePath ?: ""
        // Note: Using absolute path for local development to the existing VS Code UI
        val htmlPath = Paths.get(projectRoot, "vscode", "media", "chat.html").toUri().toString()

        jsQuery.addHandler { jsonRequest ->
            println("Kairos JetBrains Received: ${"$"}jsonRequest")
            null
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadStart(browser: CefBrowser?, frame: CefFrame?, transitionType: org.cef.network.CefRequest.TransitionType?) {
                val shim = """
                    window.acquireVsCodeApi = function() {
                        return {
                            postMessage: function(msg) {
                                ${jsQuery.inject("JSON.stringify(msg)")}
                            }
                        };
                    };
                """.trimIndent()
                browser?.executeJavaScript(shim, frame?.url, 0)
            }
        }, browser.cefBrowser)

        browser.loadURL(htmlPath)
        add(browser.component, BorderLayout.CENTER)
    }
}
