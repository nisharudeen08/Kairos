package ai.kairos.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.wm.ToolWindowManager

class OpenKairosChatAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val toolWindow = ToolWindowManager
      .getInstance(project)
      .getToolWindow("Kairos") ?: return
    toolWindow.show()
    toolWindow.activate(null)
  }
}
