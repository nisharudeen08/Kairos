package com.antigravity.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class KairosToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val browserPanel = KairosBrowserPanel(project)
        val content = ContentFactory.getInstance().createContent(browserPanel, "", false)
        toolWindow.contentManager.addContent(content)
    }
}
