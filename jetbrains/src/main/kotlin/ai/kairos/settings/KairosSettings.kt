package ai.kairos.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(
  name = "KairosSettings",
  storages = [Storage("KairosSettings.xml")]
)
class KairosSettings : PersistentStateComponent<KairosSettings.State> {

  data class State(
    var proxyUrl: String = "http://localhost:4000",
    var apiKey: String = "kairos-local",
    var selectedModel: String = "gpt-oss-20b",
    var streamingEnabled: Boolean = true
  )

  private var state = State()

  override fun getState() = state
  override fun loadState(state: State) { this.state = state }

  companion object {
    fun getInstance(): KairosSettings =
      ApplicationManager.getApplication()
        .getService(KairosSettings::class.java)
  }
}
