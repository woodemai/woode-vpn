import { type Config } from 'prettier';

const config: Config = {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  arrowParens: 'avoid',
  bracketSameLine: false,
  bracketSpacing: true,
  jsxSingleQuote: true,
  printWidth: 80,
  proseWrap: 'preserve',
  quoteProps: 'as-needed',

  singleAttributePerLine: true,
  trailingComma: 'all',
};

export default config;
