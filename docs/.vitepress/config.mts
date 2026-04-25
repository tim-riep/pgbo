import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'pgbo',
  description: 'Type-safe PostgreSQL Business Objects — tables, views, domains, auto-migration, native i18n.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  // GitHub Pages serves from /pgbo — set this to match the repo name.
  // Change this (e.g. to '/' for a custom domain) and everything below
  // stays correct because asset paths derive from it.
  base: '/pgbo/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/architecture' },
      { text: 'Reference', link: '/schema' },
      {
        text: 'Packages',
        items: [
          { text: '@pgbo/core', link: 'https://www.npmjs.com/package/@pgbo/core' },
          { text: '@pgbo/fastify', link: 'https://www.npmjs.com/package/@pgbo/fastify' },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Architecture', link: '/architecture' },
        ],
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Schema Definition', link: '/schema' },
          { text: 'Query Builder', link: '/query' },
          { text: 'Business Objects', link: '/bo' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Migration Engine', link: '/migration' },
          { text: 'Seed System', link: '/seed' },
          { text: 'CLI', link: '/cli' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Metadata', link: '/metadata' },
          { text: 'Validation', link: '/validation' },
          { text: 'i18n', link: '/i18n' },
          { text: 'Testing', link: '/testing' },
        ],
      },
      {
        text: 'Adapters',
        items: [
          { text: '@pgbo/fastify', link: '/fastify' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/tim-riep/pgbo' },
    ],

    editLink: {
      pattern: 'https://github.com/tim-riep/pgbo/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2026 Tim Riep',
    },

    outline: {
      level: [2, 3],
    },
  },
})
