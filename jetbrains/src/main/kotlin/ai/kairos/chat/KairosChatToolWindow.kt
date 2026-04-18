package ai.kairos.chat

import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class KairosChatToolWindow : ToolWindowFactory {
  override fun createToolWindowContent(
    project: Project,
    toolWindow: ToolWindow
  ) {
    val panel = KairosChatPanel()
    val content = ContentFactory.getInstance()
      .createContent(panel, "", false)
    toolWindow.contentManager.addContent(content)
    toolWindow.setIcon(
      IconLoader.getIcon("/icons/kairos.svg", javaClass)
    )
  }
}
