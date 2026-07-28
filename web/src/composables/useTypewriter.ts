import { onMounted, onUnmounted, ref } from 'vue'

const WORDS = [
  '想我了没宝宝',
  '我厉害不',
  '今天想聊什么呀',
  '快夸我快夸我',
  '你是不是又想我了',
  '来找我玩啦',
  '今天想聊点什么',
  '有什么想法需要梳理',
  '先从一个问题开始',
  '这里是你思考的空间',
]

/**
 * 空状态打字机动画：循环打字→暂停→删除→下一个词
 */
export function useTypewriter() {
  const displayedWord = ref(WORDS[0])
  let wordIndex = 0
  let charIndex = WORDS[0].length
  let isDeleting = false
  let typeTimer: ReturnType<typeof setTimeout> | null = null

  function tick() {
    const current = WORDS[wordIndex]
    if (!isDeleting) {
      if (charIndex < current.length) {
        charIndex++
        displayedWord.value = current.slice(0, charIndex) + (charIndex === current.length ? '.' : '')
        typeTimer = setTimeout(tick, 120)
      } else {
        isDeleting = true
        typeTimer = setTimeout(tick, 1500)
      }
    } else {
      if (charIndex > 0) {
        charIndex--
        displayedWord.value = current.slice(0, charIndex)
        typeTimer = setTimeout(tick, 80)
      } else {
        isDeleting = false
        wordIndex = (wordIndex + 1) % WORDS.length
        charIndex = 0
        typeTimer = setTimeout(tick, 120)
      }
    }
  }

  onMounted(() => {
    displayedWord.value = WORDS[0]
    charIndex = WORDS[0].length
    wordIndex = 0
    isDeleting = false
    tick()
  })

  onUnmounted(() => {
    if (typeTimer) clearTimeout(typeTimer)
  })

  return { displayedWord }
}
