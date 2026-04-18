package ai.kairos.chat

import ai.kairos.settings.KairosSettings
import java.awt.*
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.*
import javax.swing.border.CompoundBorder
import javax.swing.border.EmptyBorder
import javax.swing.border.LineBorder
import javax.swing.border.MatteBorder

class KairosChatPanel : JPanel(BorderLayout()) {

  private val apiClient = KairosApiClient()
  private val messageHistory = mutableListOf<Map<String, String>>()
  private var isStreaming = false

  // Colors matching Kairos theme
  private val bgDeep    = Color(0x1e1e2e)
  private val bgInput   = Color(0x2a2a3e)
  private val bgBubbleU = Color(0x4f46e5)
  private val bgBubbleA = Color(0x2a2a3e)
  private val textMain  = Color(0xd4d4e8)
  private val textDim   = Color(0x6c6c8a)
  private val accent    = Color(0xcba6f7)

  // Messages area
  private val messagesPanel = JPanel().apply {
    layout = BoxLayout(this, BoxLayout.Y_AXIS)
    background = bgDeep
    border = EmptyBorder(12, 12, 12, 12)
  }

  private val scrollPane = JScrollPane(messagesPanel).apply {
    background = bgDeep
    viewport.background = bgDeep
    border = null
    verticalScrollBarPolicy = JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
    horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
  }

  // Input area
  private val inputArea = JTextArea(3, 40).apply {
    background = bgInput
    foreground = textMain
    caretColor = textMain
    font = Font("JetBrains Mono", Font.PLAIN, 13)
    lineWrap = true
    wrapStyleWord = true
    border = EmptyBorder(8, 10, 8, 10)
    text = ""
  }

  // Send/Stop button
  private val sendBtn = JButton("↑").apply {
    background = accent
    foreground = Color(0x111111)
    font = Font("Arial", Font.BOLD, 16)
    isFocusPainted = false
    isBorderPainted = false
    preferredSize = Dimension(36, 36)
    cursor = Cursor(Cursor.HAND_CURSOR)
  }

  // Model selector
  private val modelSelector = JComboBox(arrayOf(
    "gpt-oss-20b", "gpt-oss-120b", "qwen3-coder",
    "gemini-2.5-flash", "llama-3.3-70b", "groq-llama-3.3-70b",
    "deepseek-local-quality", "nemotron-3-super", "codestral"
  )).apply {
    background = bgInput
    foreground = textDim
    font = Font("Poppins", Font.PLAIN, 11)
    // Sync with saved setting
    selectedItem = KairosSettings.getInstance().state.selectedModel
  }

  init {
    background = bgDeep
    setupLayout()
    setupListeners()
    showGreeting()
  }

  private fun setupLayout() {
    // Top bar
    val topBar = JPanel(BorderLayout()).apply {
      background = bgDeep
      border = CompoundBorder(
        MatteBorder(0, 0, 1, 0, Color(0x2a2a3e)),
        EmptyBorder(8, 12, 8, 12)
      )
      add(JLabel("KAIROS AGENT").apply {
        foreground = textDim
        font = Font("Poppins", Font.BOLD, 11)
        horizontalAlignment = SwingConstants.CENTER
      }, BorderLayout.CENTER)
    }

    // Input panel
    val inputWrapper = JPanel(BorderLayout(6, 0)).apply {
      background = bgInput
      border = CompoundBorder(
        LineBorder(Color(0x3a3a5e), 1, true),
        EmptyBorder(4, 4, 4, 4)
      )
    }
    inputWrapper.add(JScrollPane(inputArea).apply {
      border = null
      background = bgInput
      viewport.background = bgInput
    }, BorderLayout.CENTER)
    inputWrapper.add(sendBtn, BorderLayout.EAST)

    val bottomBar = JPanel(BorderLayout(8, 0)).apply {
      background = bgDeep
      border = CompoundBorder(
        MatteBorder(1, 0, 0, 0, Color(0x2a2a3e)),
        EmptyBorder(8, 12, 8, 12)
      )
      add(JLabel("Model:").apply {
        foreground = textDim
        font = Font("Poppins", Font.PLAIN, 11)
      }, BorderLayout.WEST)
      add(modelSelector, BorderLayout.CENTER)
    }

    val southPanel = JPanel(BorderLayout(0, 6)).apply {
      background = bgDeep
      border = EmptyBorder(8, 12, 10, 12)
      add(inputWrapper, BorderLayout.CENTER)
      add(bottomBar, BorderLayout.SOUTH)
    }

    add(topBar, BorderLayout.NORTH)
    add(scrollPane, BorderLayout.CENTER)
    add(southPanel, BorderLayout.SOUTH)
  }

  private fun setupListeners() {
    // Send on click
    sendBtn.addActionListener {
      if (isStreaming) {
        stopGeneration()
      } else {
        sendMessage()
      }
    }

    // Enter to send, Shift+Enter for newline
    inputArea.addKeyListener(object : KeyAdapter() {
      override fun keyPressed(e: KeyEvent) {
        if (e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown) {
          e.consume()
          if (!isStreaming) sendMessage()
        }
      }
    })

    // Update saved model when changed
    modelSelector.addActionListener {
      KairosSettings.getInstance().state.selectedModel =
        modelSelector.selectedItem as String
    }
  }

  private fun sendMessage() {
    val text = inputArea.text.trim()
    if (text.isEmpty()) return

    inputArea.text = ""
    hideGreeting()

    // Add user bubble
    addBubble(text, isUser = true)
    messageHistory.add(mapOf("role" to "user", "content" to text))

    // Create AI bubble for streaming into
    val aiBubble = addBubble("", isUser = false)
    val sb = StringBuilder()

    setStreaming(true)

    apiClient.sendMessage(
      messages = messageHistory,
      onToken = { token ->
        sb.append(token)
        aiBubble.text = sb.toString()
        scrollToBottom()
      },
      onDone = {
        if (sb.isNotEmpty()) {
          messageHistory.add(mapOf("role" to "assistant", "content" to sb.toString()))
        }
        setStreaming(false)
      },
      onError = { error ->
        aiBubble.text = "Error: $error"
        aiBubble.foreground = Color(0xf87171)
        setStreaming(false)
      }
    )
  }

  private fun stopGeneration() {
    apiClient.cancelCurrentCall()
    setStreaming(false)
  }

  private fun setStreaming(active: Boolean) {
    isStreaming = active
    if (active) {
      sendBtn.text = "■"
      sendBtn.background = Color(0x3a3a5e)
      sendBtn.foreground = textMain
      inputArea.isEnabled = false
    } else {
      sendBtn.text = "↑"
      sendBtn.background = accent
      sendBtn.foreground = Color(0x111111)
      inputArea.isEnabled = true
      inputArea.requestFocus()
    }
  }

  private fun addBubble(text: String, isUser: Boolean): JTextArea {
    val bubble = JTextArea(text).apply {
      lineWrap = true
      wrapStyleWord = true
      isEditable = false
      font = Font("JetBrains Mono", Font.PLAIN, 13)
      foreground = if (isUser) Color.WHITE else textMain
      background = if (isUser) bgBubbleU else bgBubbleA
      border = EmptyBorder(10, 14, 10, 14)
      maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
    }

    val wrapper = JPanel(BorderLayout()).apply {
      background = bgDeep
      border = EmptyBorder(4, 0, 4, 0)
      if (isUser) {
        add(bubble, BorderLayout.EAST)
      } else {
        add(bubble, BorderLayout.WEST)
      }
    }

    messagesPanel.add(wrapper)
    messagesPanel.revalidate()
    scrollToBottom()
    return bubble
  }

  private fun showGreeting() {
    val label = JLabel("Good morning.").apply {
      foreground = Color(0x2a2a3e)
      font = Font("Poppins", Font.BOLD, 28)
      horizontalAlignment = SwingConstants.CENTER
      alignmentX = Component.CENTER_ALIGNMENT
      name = "greeting"
    }
    messagesPanel.add(Box.createVerticalGlue())
    messagesPanel.add(label)
    messagesPanel.add(Box.createVerticalGlue())
  }

  private fun hideGreeting() {
    messagesPanel.components
      .filter { it is JLabel && it.name == "greeting" }
      .forEach { messagesPanel.remove(it) }
    messagesPanel.components
      .filterIsInstance<Box.Filler>()
      .forEach { messagesPanel.remove(it) }
    messagesPanel.revalidate()
    messagesPanel.repaint()
  }

  private fun scrollToBottom() {
    SwingUtilities.invokeLater {
      val sb = scrollPane.verticalScrollBar
      sb.value = sb.maximum
    }
  }
}
