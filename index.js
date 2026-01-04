const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PLUGIN_NAME = 'vite-twig-ssr';

function viteTwig(userOptions = {}) {
    const normalized = normalizeOptions(userOptions);
    let projectRoot = process.cwd();
    let twigInstance;

    const getTwig = () => {
        if (!twigInstance) {
            twigInstance = createTwigEnvironment(normalized);
        }
        return twigInstance;
    };

    const resolveViewsRoot = () => resolveToRoot(projectRoot, normalized.viewsPath);
    const resolveMockRoot = () => resolveToRoot(projectRoot, normalized.mockPath);

    return {
        name: PLUGIN_NAME,
        enforce: 'pre',

        configResolved(config) {
            projectRoot = config.root;
        },

        configureServer(server) {
            const viewsRoot = resolveViewsRoot();
            const mockRoot = resolveMockRoot();
            const watchTargets = [viewsRoot, mockRoot].filter(Boolean).filter(fs.existsSync);

            if (watchTargets.length) {
                server.watcher.add(watchTargets);
            }

            const reloadEvents = new Set(['add', 'change', 'unlink', 'addDir', 'unlinkDir']);
            server.watcher.on('all', (event, filePath) => {
                if (reloadEvents.has(event) && isTwigOrMockFile(filePath)) {
                    server.ws.send({ type: 'full-reload' });
                }
            });

            server.middlewares.use(async (req, res, next) => {
                const url = cleanUrl(req.url);
                if (!url || !url.endsWith('.twig')) {
                    return next();
                }

                try {
                    const templatePath = resolveTemplateRequest(url, viewsRoot);

                    if (!(await fileExists(templatePath))) {
                        return next();
                    }

                    const html = await renderTwigTemplate({
                        templatePath,
                        viewsRoot,
                        mockRoot,
                        projectRoot,
                        options: normalized,
                        twig: getTwig(),
                    });

                    const transformed = await server.transformIndexHtml(url, html);
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'text/html');
                    res.end(transformed);
                } catch (error) {
                    pushViteError(server, error);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'text/html');
                    res.end(renderErrorPage(error));
                }
            });
        },

        async handleHotUpdate(ctx) {
            if (isTwigOrMockFile(ctx.file)) {
                ctx.server.ws.send({ type: 'full-reload' });
                return [];
            }
        },
    };
}

function createTwigRenderer(options = {}) {
    const normalized = normalizeOptions(options);
    const projectRoot = options.root ? path.resolve(options.root) : process.cwd();
    const viewsRoot = resolveToRoot(projectRoot, normalized.viewsPath);
    const mockRoot = resolveToRoot(projectRoot, normalized.mockPath);
    const twig = createTwigEnvironment(normalized);

    return {
        async render(templatePath, locals = {}) {
            const absoluteTemplate = path.isAbsolute(templatePath)
                ? templatePath
                : path.join(viewsRoot, templatePath);

            return renderTwigTemplate({
                templatePath: absoluteTemplate,
                viewsRoot,
                mockRoot,
                projectRoot,
                options: normalized,
                twig,
                locals,
            });
        },
    };
}

async function renderTwigTemplate({
    templatePath,
    viewsRoot,
    mockRoot,
    projectRoot,
    options,
    twig,
    locals = {},
}) {
    if (!templatePath.startsWith(viewsRoot)) {
        throw new Error(`Twig template must live inside viewsPath. Received: ${templatePath}`);
    }

    if (!(await fileExists(templatePath))) {
        throw new Error(`Twig template not found: ${templatePath}`);
    }

    const twigOptions = {
        path: templatePath,
        async: false,
        rethrow: true,
        allowInlineIncludes: true,
        base: options.base ? resolveToRoot(projectRoot, options.base) : viewsRoot,
    };

    const namespaces = resolveNamespaces(options.namespaces, projectRoot);
    if (namespaces) {
        twigOptions.namespaces = namespaces;
    }

    if (options.debug !== undefined) {
        twigOptions.debug = options.debug;
    }
    if (options.trace !== undefined) {
        twigOptions.trace = options.trace;
    }

    twig.cache(false);
    const template = twig.twig(twigOptions);

    const mockData = await loadMockData({
        templatePath,
        viewsRoot,
        mockRoot,
        allowMissing: options.allowMissingMock !== false,
    });

    const context = mergeData({}, options.globalData);
    mergeData(context, mockData);
    mergeData(context, locals);

    context.current = context.current || {};
    context.page = context.page || {};
    context.opts = context.opts || {};

    if (context.current.content && typeof context.current.content !== 'string') {
        context.current.content = JSON.stringify(context.current.content);
    }

    context.feVersion = context.feVersion || defaultFeVersion();

    const relativePath = path.relative(viewsRoot, templatePath);
    context._file = {
        path: templatePath,
        relative: relativePath,
    };
    context._target = {
        path: path.join(projectRoot, relativePath.replace(/\.twig$/, '.html')),
        relative: relativePath.replace(/\.twig$/, '.html'),
    };

    return template.render(context);
}

function loadMockData({ templatePath, viewsRoot, mockRoot, allowMissing }) {
    const relativePath = path.relative(viewsRoot, templatePath);
    const jsonPath = path.join(mockRoot, relativePath.replace(/\.twig$/, '.json'));

    return fsp
        .readFile(jsonPath, 'utf8')
        .then((raw) => JSON.parse(raw))
        .catch((error) => {
            if (error.code === 'ENOENT' && allowMissing) {
                return {};
            }

            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON in ${jsonPath}: ${error.message}`);
            }

            if (error.code === 'ENOENT') {
                throw new Error(`Missing mock data for template ${relativePath}. Expected file: ${jsonPath}`);
            }

            throw error;
        });
}

function createTwigEnvironment(options) {
    const Twig = require('twig');
    Twig.cache(false);

    if (options.extend) {
        Twig.extend(options.extend);
    }

    normalizeExtensions(options.functions).forEach(({ name, func }) => {
        Twig.extendFunction(name, func);
    });

    normalizeExtensions(options.filters).forEach(({ name, func }) => {
        Twig.extendFilter(name, func);
    });

    return Twig;
}

function normalizeOptions(userOptions) {
    const defaults = {
        mockPath: 'mock',
        viewsPath: 'src',
        globalData: {},
        filters: {},
        functions: {},
        namespaces: {},
        allowMissingMock: true,
    };

    const normalized = {
        ...defaults,
        ...userOptions,
    };

    const defaultGlobals = { feVersion: defaultFeVersion() };
    normalized.globalData = mergeData({}, defaultGlobals);
    mergeData(normalized.globalData, userOptions.globalData || {});

    normalized.filters = userOptions.filters || {};
    normalized.functions = userOptions.functions || {};
    normalized.namespaces = userOptions.namespaces || {};

    return normalized;
}

function normalizeExtensions(entries) {
    if (!entries) {
        return [];
    }

    if (Array.isArray(entries)) {
        return entries
            .filter(Boolean)
            .map((entry) => ({ name: entry.name, func: entry.func }))
            .filter((entry) => typeof entry.name === 'string' && typeof entry.func === 'function');
    }

    return Object.keys(entries)
        .map((name) => ({ name, func: entries[name] }))
        .filter((entry) => typeof entry.func === 'function');
}

function resolveNamespaces(namespaces, projectRoot) {
    const names = Object.keys(namespaces || {});
    if (!names.length) {
        return undefined;
    }

    return names.reduce((acc, key) => {
        acc[key] = path.resolve(projectRoot, namespaces[key]);
        return acc;
    }, {});
}

async function fileExists(targetPath) {
    try {
        await fsp.access(targetPath, fs.constants.F_OK);
        return true;
    } catch (error) {
        return false;
    }
}

function cleanUrl(url = '') {
    return url.split('?')[0].split('#')[0];
}

function resolveTemplateRequest(requestUrl, viewsRoot) {
    const cleaned = requestUrl.replace(/^\/+/, '');
    let relativeRequest = safeDecodeURIComponent(cleaned);

    // Allow requests like /views/index.twig to map to viewsRoot/index.twig
    if (relativeRequest.startsWith('views/')) {
        relativeRequest = relativeRequest.replace(/^views\//, '');
    }

    const resolved = path.resolve(viewsRoot, relativeRequest);
    if (!resolved.startsWith(viewsRoot)) {
        throw new Error(`Twig request tried to access outside of viewsPath: ${requestUrl}`);
    }
    return resolved;
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
}

function resolveToRoot(root, targetPath) {
    if (!targetPath) {
        return root;
    }
    return path.isAbsolute(targetPath) ? targetPath : path.resolve(root, targetPath);
}

function mergeData(target, source) {
    if (!source || typeof source !== 'object') {
        return target;
    }

    Object.keys(source).forEach((key) => {
        const value = source[key];
        if (Array.isArray(value)) {
            target[key] = value.map((item) => (typeof item === 'object' ? mergeData({}, item) : item));
            return;
        }

        if (value && typeof value === 'object') {
            if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
                target[key] = {};
            }
            mergeData(target[key], value);
            return;
        }

        target[key] = value;
    });

    return target;
}

function pushViteError(server, error) {
    server.ws.send({
        type: 'error',
        err: {
            message: error.message,
            stack: error.stack,
        },
    });
}

function renderErrorPage(error) {
    return `<!doctype html>
<html>
    <head>
        <meta charset="utf-8" />
        <title>Twig Render Error</title>
        <style>
            body { font-family: system-ui, sans-serif; padding: 2rem; color: #f5f5f5; background: #1a1a1a; }
            pre { background: #2a2a2a; padding: 1rem; border-radius: 8px; overflow-x: auto; }
        </style>
    </head>
    <body>
        <h1>Twig render error</h1>
        <p>${escapeHtml(error.message)}</p>
        <pre>${escapeHtml(error.stack || '')}</pre>
    </body>
</html>`;
}

function escapeHtml(str = '') {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function defaultFeVersion() {
    return process.env.FE_VERSION || process.env.npm_package_version || 'dev';
}

function isTwigOrMockFile(filePath = '') {
    return filePath.endsWith('.twig') || filePath.endsWith('.json');
}

module.exports = viteTwig;
module.exports.viteTwig = viteTwig;
module.exports.createTwigRenderer = createTwigRenderer;
module.exports.renderTwigTemplate = renderTwigTemplate;
module.exports.default = viteTwig;
