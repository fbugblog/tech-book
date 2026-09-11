import DefaultTheme from 'vitepress/theme'
import BookIndex from './BookIndex.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // トップページ（docs/index.md）で <BookIndex /> として使う
    app.component('BookIndex', BookIndex)
  },
}
