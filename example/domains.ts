// Reusable domain types

import { domain } from '../packages/pgbo/src/schema/domain.js'
import { text, integer } from '../packages/pgbo/src/schema/types.js'

export const slug = domain('slug', text().minLength(1).maxLength(128).pattern(/^[a-z0-9-]+$/))

export const tenantId = domain('tenant_id', integer()).references('tenant', 'id', 'CASCADE')

export const email = domain('email', text().minLength(5).maxLength(255).pattern(/^[^@]+@[^@]+\.[^@]+$/))
