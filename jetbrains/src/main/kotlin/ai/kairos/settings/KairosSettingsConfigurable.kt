package ai.kairos.settings

import com.intellij.openapi.options.Configurable
import com.intellij.util.ui.FormBuilder
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JTextField

class KairosSettingsConfigurable : Configurable {

  private lateinit var proxyUrlField: JTextField
  private lateinit var apiKeyField: JTextField
  private lateinit var modelField: JTextField
  private lateinit var streamingCheckbox: JCheckBox

  override fun getDisplayName() = "Kairos AI"

  override fun createComponent(): JComponent {
    val settings = KairosSettings.getInstance().state

    proxyUrlField = JTextField(settings.proxyUrl, 30)
    apiKeyField   = JTextField(settings.apiKey, 30)
    modelField    = JTextField(settings.selectedModel, 30)
    streamingCheckbox = JCheckBox("Enable streaming", settings.streamingEnabled)

    return FormBuilder.createFormBuilder()
      .addLabeledComponent("LiteLLM Proxy URL:", proxyUrlField)
      .addLabeledComponent("API Key:", apiKeyField)
      .addLabeledComponent("Default Model:", modelField)
      .addComponent(streamingCheckbox)
      .addComponentFillVertically(JPanel(), 0)
      .panel
  }

  override fun isModified(): Boolean {
    val s = KairosSettings.getInstance().state
    return proxyUrlField.text != s.proxyUrl ||
           apiKeyField.text   != s.apiKey   ||
           modelField.text    != s.selectedModel ||
           streamingCheckbox.isSelected != s.streamingEnabled
  }

  override fun apply() {
    val s = KairosSettings.getInstance().state
    s.proxyUrl          = proxyUrlField.text.trimEnd('/')
    s.apiKey            = apiKeyField.text
    s.selectedModel     = modelField.text
    s.streamingEnabled  = streamingCheckbox.isSelected
  }

  override fun reset() {
    val s = KairosSettings.getInstance().state
    proxyUrlField.text          = s.proxyUrl
    apiKeyField.text            = s.apiKey
    modelField.text             = s.selectedModel
    streamingCheckbox.isSelected = s.streamingEnabled
  }
}
