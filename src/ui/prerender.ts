// Runs at build time only. Crawlers that read web pages for AI systems do not run JavaScript, so
// the landing page has to be in the delivered HTML. It is rendered from the same component and
// copy as the live page, so that the two cannot drift apart.
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import LandingContent from './LandingContent.vue';
import { REPOSITORY_URL } from '../config';
import { FAQ, LEDE } from './landingCopy';

const SITE = 'https://modemlens.k-i-soft.ch/';
const ORGANIZATION = 'https://www.k-i-soft.ch/#organization';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function landingHtml(): Promise<string> {
  const content = (await renderToString(createSSRApp(LandingContent)))
    // Icons and framework markers mean nothing to a reader of the raw page.
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/ data-v-[0-9a-f]+(="")?/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return `<main class="prerender"><h1>ModemLens</h1><p>${escapeHtml(LEDE)}</p>${content}</main>`;
}

/** Deliberately no Product or SoftwareApplication node: search engines reject those without ratings. */
export function structuredData(): string {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORGANIZATION,
        name: 'K-I-Soft',
        legalName: 'K-I-Soft IT&Holding GmbH',
        taxID: 'CHE-366.968.537',
        url: 'https://www.k-i-soft.ch/',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Bernstrasse 27b',
          addressLocality: 'Kehrsatz',
          addressRegion: 'BE',
          postalCode: '3122',
          addressCountry: 'CH',
        },
        sameAs: ['https://www.zefix.ch/en/search/entity/list/firm/CHE-366.968.537', 'https://github.com/k-i-soft'],
      },
      { '@type': 'WebSite', '@id': `${SITE}#website`, url: SITE, name: 'ModemLens', inLanguage: 'en', publisher: { '@id': ORGANIZATION } },
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${SITE}#code`,
        name: 'ModemLens',
        description: LEDE,
        url: SITE,
        codeRepository: REPOSITORY_URL,
        programmingLanguage: 'TypeScript',
        license: 'https://opensource.org/license/mit',
        author: { '@id': ORGANIZATION },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE}#faq`,
        url: SITE,
        isPartOf: { '@id': `${SITE}#website` },
        mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}
