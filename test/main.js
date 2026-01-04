const fs = require('node:fs');
const path = require('node:path');
const should = require('should');

const { createTwigRenderer } = require('..');

require('mocha');

describe('vite-twig-ssr renderer', function () {
  const fixturesRoot = path.join(__dirname, 'fixtures');
  const viewsPath = path.join(fixturesRoot, 'views');
  const mockPath = path.join(fixturesRoot, 'mock');

  const renderer = createTwigRenderer({
    viewsPath,
    mockPath,
    globalData: {
      site_name: 'Demo Site',
      opts: {
        default: {
          contact_mail: 'global@example.com',
        },
      },
    },
    filters: {
      uppercase: (value) => String(value || '').toUpperCase(),
    },
    functions: {
      asset: (value) => `/static/${value}`,
    },
  });

  it('renders twig templates with mock data, globals, filters and functions', async function () {
    const html = await renderer.render('about.twig');

    should.exist(html);
    html.should.match(/About Twig/);
    html.should.match(/<div class="content"><p>Rendered via Twig.js<\/p><\/div>/);
    html.should.match(/2\. About/);
    html.should.match(/VITE TWIG/);
    html.should.match(/href="\/static\/logo\.svg"/);
    html.should.match(/support@example.com/);
    html.should.match(/data-template="about\.twig"/);
  });

  it('merges fallback global data and render-time locals when mock JSON is absent', async function () {
    const html = await renderer.render('minimal.twig', { fromTest: 'OK' });

    html.should.match(/OK/);
    html.should.match(/global@example.com/);
  });

  it('surfaces invalid JSON errors with helpful messaging', async function () {
    const jsonPath = path.join(mockPath, 'needs-data.json');
    const originalSource = fs.readFileSync(jsonPath, 'utf8');
    const invalidSource = '{\n  "current": {\n    "title": "Broken"\n  },\n}\n';

    fs.writeFileSync(jsonPath, invalidSource, 'utf8');

    try {
      await renderer.render('needs-data.twig');
      throw new Error('render should have failed for invalid JSON');
    } catch (error) {
      error.message.should.match(/Invalid JSON/);
    } finally {
      fs.writeFileSync(jsonPath, originalSource, 'utf8');
    }
  });

  it('can enforce mock files via allowMissingMock=false', async function () {
    const strictRenderer = createTwigRenderer({
      viewsPath,
      mockPath,
      allowMissingMock: false,
    });

    try {
      await strictRenderer.render('missing.twig');
      throw new Error('render should require a matching mock file');
    } catch (error) {
      error.message.should.match(/Missing mock data/);
    }
  });
});
