export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'security',
        'perf',
        'refactor',
        'test',
        'docs',
        'style',
        'chore',
        'ci',
        'revert',
      ],
    ],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [0],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [1, 'always'],
  },
};
