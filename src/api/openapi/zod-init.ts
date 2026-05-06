/**
 * Side-effect-only entry that extends zod with the `.openapi(...)` augmentation
 * provided by `@asteasolutions/zod-to-openapi`. Every other module in the
 * `openapi/` folder imports this module *first* so any subsequent `.openapi`
 * call resolves at module load time.
 *
 * Importing zod-to-openapi from anywhere else in the codebase without going
 * through this module risks a "x.openapi is not a function" TypeError because
 * the augmentation is registered lazily.
 */

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);
