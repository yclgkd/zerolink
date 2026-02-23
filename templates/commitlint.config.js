// Commitlint 配置 - Conventional Commits 规范
// 复制到项目根目录

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 类型枚举
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // Bug 修复
        'security', // 安全修复（ZeroLink 特定）
        'perf', // 性能优化
        'refactor', // 重构
        'test', // 测试
        'docs', // 文档
        'style', // 代码格式（不影响逻辑）
        'chore', // 构建/工具/依赖
        'ci', // CI 配置
        'revert', // 回滚
      ],
    ],
    // 主题不能为空
    'subject-empty': [2, 'never'],
    // 主题不能以句号结尾
    'subject-full-stop': [2, 'never', '.'],
    // 主题大小写（不限制，允许自然语言）
    'subject-case': [0],
    // Body 前必须有空行
    'body-leading-blank': [2, 'always'],
    // Footer 前必须有空行
    'footer-leading-blank': [1, 'always'],
  },
};
