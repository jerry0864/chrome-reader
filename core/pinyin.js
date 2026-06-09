// 拼音工具：依赖全局 window.pinyinPro（由 lib/pinyin-pro.js 经典脚本注入）。
// 中文转无声调全小写连写拼音；非中文按原样保留；库缺失或出错时回退原文。
export function toPinyin(text) {
  if (!text || typeof pinyinPro === 'undefined') return text;
  try {
    return pinyinPro
      .pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .join('')
      .toLowerCase();
  } catch {
    return text;
  }
}

// 按标题模式返回展示用书名：'pinyin' → 拼音，其它 → 原文。
export function displayTitle(text, titleMode) {
  return titleMode === 'pinyin' ? toPinyin(text) : text;
}
