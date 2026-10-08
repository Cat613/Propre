import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
export default [
  {ignores:['node_modules/**','dist/**','dist-electron/**','release/**','test-results/**','src/assets/**']},
  {files:['src/**/*.{ts,tsx}'],languageOptions:{parser:tseslint.parser,parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error'}},
]
