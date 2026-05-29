const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.log('用法: node build_dict.js <合并版词库JSON文件路径>');
  console.log('示例: node build_dict.js /home/zalo/Documents/edg-plug/词根ai/模版.json');
  process.exit(1);
}

const inputPath = path.resolve(process.argv[2]);
const targetAssetsDir = path.resolve(__dirname, 'src/assets');
const partsDir = path.join(targetAssetsDir, 'dict_parts');

// 确保目录存在
if (!fs.existsSync(targetAssetsDir)) {
  fs.mkdirSync(targetAssetsDir, { recursive: true });
}
if (!fs.existsSync(partsDir)) {
  fs.mkdirSync(partsDir, { recursive: true });
}

// 提取分片前缀规则（必须和 App 里的 offlineDict.ts 保持绝对一致）
function getPrefix(key) {
  const rawName = key.substring(2).trim().toLowerCase();
  const cleanName = rawName.replace(/^-|-$/g, '').replace(/[\\\/]/g, '_');
  if (cleanName.length === 0) return '_empty';
  if (cleanName.length === 1) return cleanName;
  return cleanName.substring(0, 2);
}

console.log(`正在读取总词库文件: ${inputPath}...`);
const db = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const parts = {};
const wordsPreview = [];
const rootsPreview = [];

let wordCount = 0;
let rootCount = 0;

for (const [key, value] of Object.entries(db)) {
  const prefix = getPrefix(key);
  if (!parts[prefix]) {
    parts[prefix] = {};
  }
  parts[prefix][key] = value;

  // 构建预览列表用于词库、词根库页面快速展示
  if (key.startsWith('W:')) {
    wordCount++;
    wordsPreview.push({
      word: value.word,
      phonetic: value.phonetic_us || '',
      translation: value.primary_meaning || '',
      context: value.context || 'general',
    });
  } else if (key.startsWith('R:')) {
    rootCount++;
    rootsPreview.push({
      root: value.segment || key.substring(2),
      type: value.type || '词根',
      meaning: value.meaning || '',
    });
  }
}

console.log(`解析完毕！共发现 ${wordCount} 个单词, ${rootCount} 个词根。`);
console.log(`开始切片并写入到 ${partsDir}...`);

let partCount = 0;
for (const [prefix, data] of Object.entries(parts)) {
  fs.writeFileSync(
    path.join(partsDir, `${prefix}.json`),
    JSON.stringify(data)
  );
  partCount++;
}

console.log(`成功生成 ${partCount} 个分片文件。`);

// 写入预览列表
fs.writeFileSync(
  path.join(targetAssetsDir, 'offline_words_preview.json'),
  JSON.stringify(wordsPreview)
);
fs.writeFileSync(
  path.join(targetAssetsDir, 'offline_roots_preview.json'),
  JSON.stringify(rootsPreview)
);

console.log('成功生成预览缓存。');
console.log('');
console.log('🎉 词库切片内置构建完成！');
console.log('现在你可以直接在根目录执行: cd android && ./gradlew assembleRelease');
