const {
  parseCompactConvo,
  EModelEndpoint,
  isAgentsEndpoint,
  EndpointURLs,
} = require('librechat-data-provider');
const azureAssistants = require('~/server/services/Endpoints/azureAssistants');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const assistants = require('~/server/services/Endpoints/assistants');
const gptPlugins = require('~/server/services/Endpoints/gptPlugins');
const { processFiles } = require('~/server/services/Files/process');
const anthropic = require('~/server/services/Endpoints/anthropic');
const bedrock = require('~/server/services/Endpoints/bedrock');
const openAI = require('~/server/services/Endpoints/openAI');
const agents = require('~/server/services/Endpoints/agents');
const custom = require('~/server/services/Endpoints/custom');
const google = require('~/server/services/Endpoints/google');
const external = require('~/server/services/Endpoints/external');
const { handleError } = require('~/server/utils');

const buildFunction = {
  [EModelEndpoint.openAI]: openAI.buildOptions,
  [EModelEndpoint.google]: google.buildOptions,
  [EModelEndpoint.custom]: custom.buildOptions,
  [EModelEndpoint.agents]: agents.buildOptions,
  [EModelEndpoint.bedrock]: bedrock.buildOptions,
  [EModelEndpoint.azureOpenAI]: openAI.buildOptions,
  [EModelEndpoint.anthropic]: anthropic.buildOptions,
  [EModelEndpoint.gptPlugins]: gptPlugins.buildOptions,
  [EModelEndpoint.assistants]: assistants.buildOptions,
  [EModelEndpoint.azureAssistants]: azureAssistants.buildOptions,
  [EModelEndpoint.external]: external.buildOptions,
};

async function buildEndpointOption(req, res, next) {
  const { endpoint, endpointType } = req.body;
  let parsedBody;
  try {
    parsedBody = parseCompactConvo({ endpoint, endpointType, conversation: req.body });
  } catch (error) {
    return handleError(res, { text: 'Error parsing conversation' });
  }

  if (req.app.locals.modelSpecs?.list && req.app.locals.modelSpecs?.enforce) {
    /** @type {{ list: TModelSpec[] }}*/
    const { list } = req.app.locals.modelSpecs;
    const { spec } = parsedBody;

    if (!spec) {
      return handleError(res, { text: 'No model spec selected' });
    }

    const currentModelSpec = list.find((s) => s.name === spec);
    if (!currentModelSpec) {
      return handleError(res, { text: 'Invalid model spec' });
    }

    if (endpoint !== currentModelSpec.preset.endpoint) {
      return handleError(res, { text: 'Model spec mismatch' });
    }

    if (
      currentModelSpec.preset.endpoint !== EModelEndpoint.gptPlugins &&
      currentModelSpec.preset.tools
    ) {
      return handleError(res, {
        text: `Only the "${EModelEndpoint.gptPlugins}" endpoint can have tools defined in the preset`,
      });
    }

    try {
      currentModelSpec.preset.spec = spec;
      if (currentModelSpec.iconURL != null && currentModelSpec.iconURL !== '') {
        currentModelSpec.preset.iconURL = currentModelSpec.iconURL;
      }
      parsedBody = parseCompactConvo({
        endpoint,
        endpointType,
        conversation: currentModelSpec.preset,
      });
    } catch (error) {
      return handleError(res, { text: 'Error parsing model spec' });
    }
  }

  try {
    const isAgents =
      isAgentsEndpoint(endpoint) || req.baseUrl.startsWith(EndpointURLs[EModelEndpoint.agents]);
    const endpointFn = buildFunction[isAgents ? EModelEndpoint.agents : (endpointType ?? endpoint)];
    const builder = isAgents ? (...args) => endpointFn(req, ...args) : endpointFn;

    // TODO: use object params
    req.body.endpointOption = await builder(endpoint, parsedBody, endpointType);

    // TODO: use `getModelsConfig` only when necessary
    const modelsConfig = await getModelsConfig(req);
    req.body.endpointOption.modelsConfig = modelsConfig;
    if (req.body.files && !isAgents) {
      req.body.endpointOption.attachments = processFiles(req.body.files);
    }
    next();
  } catch (error) {
    return handleError(res, { text: 'Error building endpoint option' });
  }
}

module.exports = buildEndpointOption;
