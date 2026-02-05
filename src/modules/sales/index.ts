import { Router, Request, Response } from 'express';
import prisma from '../../core/db';
import { authMiddleware } from '../../middleware/auth';
import { requireModuleEnabled } from '../../middleware/modules';
import { requirePermission } from '../../middleware/permissions';
import { moduleRegistry } from '../../core/modules/registry';
import type { ModuleManifest } from '@cloud-org/shared';

const router = Router();

// Module manifest
export const salesManifest: ModuleManifest = {
  key: 'sales',
  name: 'Sales & CRM',
  icon: 'briefcase',
  sidebarItems: [
    {
      path: '/sales/leads',
      label: 'Leads',
      permission: 'sales.leads.view',
    },
    {
      path: '/sales/opportunities',
      label: 'Opportunities',
      permission: 'sales.opportunities.view',
    },
    {
      path: '/sales/contacts',
      label: 'Contacts',
      permission: 'sales.contacts.view',
    },
    {
      path: '/sales/accounts',
      label: 'Accounts',
      permission: 'sales.accounts.view',
    },
    {
      path: '/sales/quotes',
      label: 'Quotes',
      permission: 'sales.quotes.view',
    },
    {
      path: '/sales/activities',
      label: 'Activities',
      permission: 'sales.activities.view',
    },
    {
      path: '/sales/pipeline',
      label: 'Pipeline',
      permission: 'sales.opportunities.view',
    },
  ],
  dashboardWidgets: [
    {
      id: 'sales-leads-count',
      title: 'Total Leads',
      description: 'Number of leads',
      apiPath: '/api/sales/widgets/leads-count',
      permission: 'sales.leads.view',
    },
    {
      id: 'sales-opportunities-value',
      title: 'Pipeline Value',
      description: 'Total value of open opportunities',
      apiPath: '/api/sales/widgets/pipeline-value',
      permission: 'sales.opportunities.view',
    },
  ],
};

// Register module
export function registerSalesModule(routerInstance: Router): void {
  routerInstance.use('/api/sales', authMiddleware, requireModuleEnabled('sales'), router);

  moduleRegistry.register({
    key: 'sales',
    manifest: salesManifest,
    registerRoutes: () => {},
  });
}

// ============================================
// LEADS
// ============================================

// GET /api/sales/leads - List leads
router.get('/leads', requirePermission('sales.leads.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, ownerId, search, leadSource } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;
    if (leadSource) where.leadSource = leadSource;

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { company: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        contact: true,
        _count: {
          select: { activities: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(leads);
  } catch (error: any) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/sales/leads/:id - Get lead
router.get('/leads/:id', requirePermission('sales.leads.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const lead = await prisma.lead.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        contact: true,
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json(lead);
  } catch (error: any) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/sales/leads - Create lead
router.post('/leads', requirePermission('sales.leads.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { firstName, lastName, company, email, phone, mobile, title, website, industry, leadSource, rating, status, description, ownerId } = req.body;

    if (!firstName) {
      res.status(400).json({ error: 'First name is required' });
      return;
    }

    const lead = await prisma.lead.create({
      data: {
        orgId: req.org.id,
        firstName,
        lastName: lastName || null,
        company: company || null,
        email: email || null,
        phone: phone || null,
        mobile: mobile || null,
        title: title || null,
        website: website || null,
        industry: industry || null,
        leadSource: leadSource || null,
        rating: rating || null,
        status: status || 'new',
        description: description || null,
        ownerId: ownerId || null,
      },
      include: {
        contact: true,
      },
    });

    res.status(201).json(lead);
  } catch (error: any) {
    console.error('Error creating lead:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/leads/:id - Update lead
router.put('/leads/:id', requirePermission('sales.leads.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    });

    const lead = await prisma.lead.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        contact: true,
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating lead:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/leads/:id/convert - Convert lead to contact/opportunity
router.put('/leads/:id/convert', requirePermission('sales.leads.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { accountId, opportunityName, amount, stage } = req.body;

    const lead = await prisma.lead.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Create contact
    const contact = await prisma.contact.create({
      data: {
        orgId: req.org.id,
        accountId: accountId || null,
        firstName: lead.firstName,
        lastName: lead.lastName || '',
        email: lead.email || null,
        phone: lead.phone || null,
        mobile: lead.mobile || null,
        title: lead.title || null,
        leadSource: lead.leadSource || null,
        ownerId: lead.ownerId || null,
      },
    });

    // Create opportunity if provided
    let opportunity = null;
    if (opportunityName) {
      opportunity = await prisma.opportunity.create({
        data: {
          orgId: req.org.id,
          accountId: accountId || null,
          contactId: contact.id,
          name: opportunityName,
          stage: stage || 'prospecting',
          amount: amount ? Math.round(amount * 100) : null,
          ownerId: lead.ownerId || null,
        },
      });
    }

    // Update lead
    const updated = await prisma.lead.update({
      where: { id },
      data: {
        status: 'converted',
        contactId: contact.id,
        convertedAt: new Date(),
        convertedOpportunityId: opportunity?.id || null,
      },
      include: {
        contact: true,
      },
    });

    res.json({ lead: updated, contact, opportunity });
  } catch (error: any) {
    console.error('Error converting lead:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/sales/leads/:id - Delete lead
router.delete('/leads/:id', requirePermission('sales.leads.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.lead.delete({
      where: { id },
    });

    res.json({ message: 'Lead deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// OPPORTUNITIES
// ============================================

// GET /api/sales/opportunities - List opportunities
router.get('/opportunities', requirePermission('sales.opportunities.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { stage, accountId, contactId, ownerId, search } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (stage) where.stage = stage;
    if (accountId) where.accountId = accountId;
    if (contactId) where.contactId = contactId;
    if (ownerId) where.ownerId = ownerId;

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const opportunities = await prisma.opportunity.findMany({
      where,
      include: {
        account: true,
        contact: true,
        _count: {
          select: { quotes: true, activities: true },
        },
      },
      orderBy: {
        closeDate: 'asc',
      },
    });

    res.json(opportunities);
  } catch (error: any) {
    console.error('Error fetching opportunities:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/sales/pipeline - Get pipeline view (opportunities grouped by stage)
router.get('/pipeline', requirePermission('sales.opportunities.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const opportunities = await prisma.opportunity.findMany({
      where: {
        orgId: req.org.id,
        stage: {
          notIn: ['closed_won', 'closed_lost'],
        },
      },
      include: {
        account: true,
        contact: true,
      },
      orderBy: {
        closeDate: 'asc',
      },
    });

    // Group by stage
    const pipeline: Record<string, any[]> = {};
    opportunities.forEach((opp) => {
      if (!pipeline[opp.stage]) {
        pipeline[opp.stage] = [];
      }
      pipeline[opp.stage].push(opp);
    });

    // Calculate totals
    const totals: Record<string, number> = {};
    Object.keys(pipeline).forEach((stage) => {
      totals[stage] = pipeline[stage].reduce((sum, opp) => sum + (opp.amount || 0), 0);
    });

    res.json({ pipeline, totals, stages: Object.keys(pipeline) });
  } catch (error: any) {
    console.error('Error fetching pipeline:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/sales/opportunities - Create opportunity
router.post('/opportunities', requirePermission('sales.opportunities.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, stage, probability, amount, currency, closeDate, type, leadSource, nextStep, accountId, contactId, ownerId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const opportunity = await prisma.opportunity.create({
      data: {
        orgId: req.org.id,
        name,
        description: description || null,
        stage: stage || 'prospecting',
        probability: probability || 10,
        amount: amount ? Math.round(amount * 100) : null,
        currency: currency || 'SAR',
        closeDate: closeDate ? new Date(closeDate) : null,
        type: type || null,
        leadSource: leadSource || null,
        nextStep: nextStep || null,
        accountId: accountId || null,
        contactId: contactId || null,
        ownerId: ownerId || null,
      },
      include: {
        account: true,
        contact: true,
      },
    });

    res.status(201).json(opportunity);
  } catch (error: any) {
    console.error('Error creating opportunity:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/opportunities/:id - Update opportunity
router.put('/opportunities/:id', requirePermission('sales.opportunities.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'amount') {
          updateData[key] = Math.round(req.body[key] * 100);
        } else if (key === 'closeDate') {
          updateData[key] = new Date(req.body[key]);
        } else {
          updateData[key] = req.body[key];
        }
      }
    });

    const opportunity = await prisma.opportunity.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!opportunity) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    const updated = await prisma.opportunity.update({
      where: { id },
      data: updateData,
      include: {
        account: true,
        contact: true,
        quotes: true,
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating opportunity:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/sales/opportunities/:id - Delete opportunity
router.delete('/opportunities/:id', requirePermission('sales.opportunities.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.opportunity.delete({
      where: { id },
    });

    res.json({ message: 'Opportunity deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting opportunity:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// CONTACTS
// ============================================

// GET /api/sales/contacts - List contacts
router.get('/contacts', requirePermission('sales.contacts.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accountId, status, ownerId, search } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (accountId) where.accountId = accountId;
    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const contacts = await prisma.contact.findMany({
      where,
      include: {
        account: true,
        _count: {
          select: { leads: true, opportunities: true, quotes: true, activities: true },
        },
      },
      orderBy: {
        lastName: 'asc',
      },
    });

    res.json(contacts);
  } catch (error: any) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/sales/contacts - Create contact
router.post('/contacts', requirePermission('sales.contacts.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { firstName, lastName, accountId, email, phone, mobile, title, department, mailingStreet, mailingCity, mailingState, mailingPostalCode, mailingCountry, description, leadSource, status, ownerId } = req.body;

    if (!firstName) {
      res.status(400).json({ error: 'First name is required' });
      return;
    }

    const contact = await prisma.contact.create({
      data: {
        orgId: req.org.id,
        firstName,
        lastName: lastName || '',
        accountId: accountId || null,
        email: email || null,
        phone: phone || null,
        mobile: mobile || null,
        title: title || null,
        department: department || null,
        mailingStreet: mailingStreet || null,
        mailingCity: mailingCity || null,
        mailingState: mailingState || null,
        mailingPostalCode: mailingPostalCode || null,
        mailingCountry: mailingCountry || null,
        description: description || null,
        leadSource: leadSource || null,
        status: status || 'active',
        ownerId: ownerId || null,
      },
      include: {
        account: true,
      },
    });

    res.status(201).json(contact);
  } catch (error: any) {
    console.error('Error creating contact:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/contacts/:id - Update contact
router.put('/contacts/:id', requirePermission('sales.contacts.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    });

    const contact = await prisma.contact.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    const updated = await prisma.contact.update({
      where: { id },
      data: updateData,
      include: {
        account: true,
        leads: true,
        opportunities: true,
        quotes: true,
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating contact:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/sales/contacts/:id - Delete contact
router.delete('/contacts/:id', requirePermission('sales.contacts.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.contact.delete({
      where: { id },
    });

    res.json({ message: 'Contact deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting contact:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// ACCOUNTS
// ============================================

// GET /api/sales/accounts - List accounts
router.get('/accounts', requirePermission('sales.accounts.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { type, status, ownerId, search } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (type) where.type = type;
    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const accounts = await prisma.account.findMany({
      where,
      include: {
        _count: {
          select: { contacts: true, opportunities: true, quotes: true, activities: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    res.json(accounts);
  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/sales/accounts - Create account
router.post('/accounts', requirePermission('sales.accounts.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, type, industry, website, phone, email, billingStreet, billingCity, billingState, billingPostalCode, billingCountry, shippingStreet, shippingCity, shippingState, shippingPostalCode, shippingCountry, description, annualRevenue, employees, rating, status, ownerId } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const account = await prisma.account.create({
      data: {
        orgId: req.org.id,
        name,
        type: type || 'customer',
        industry: industry || null,
        website: website || null,
        phone: phone || null,
        email: email || null,
        billingStreet: billingStreet || null,
        billingCity: billingCity || null,
        billingState: billingState || null,
        billingPostalCode: billingPostalCode || null,
        billingCountry: billingCountry || null,
        shippingStreet: shippingStreet || null,
        shippingCity: shippingCity || null,
        shippingState: shippingState || null,
        shippingPostalCode: shippingPostalCode || null,
        shippingCountry: shippingCountry || null,
        description: description || null,
        annualRevenue: annualRevenue ? Math.round(annualRevenue * 100) : null,
        employees: employees || null,
        rating: rating || null,
        status: status || 'active',
        ownerId: ownerId || null,
      },
    });

    res.status(201).json(account);
  } catch (error: any) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/accounts/:id - Update account
router.put('/accounts/:id', requirePermission('sales.accounts.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'annualRevenue') {
          updateData[key] = Math.round(req.body[key] * 100);
        } else {
          updateData[key] = req.body[key];
        }
      }
    });

    const account = await prisma.account.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const updated = await prisma.account.update({
      where: { id },
      data: updateData,
      include: {
        contacts: true,
        opportunities: true,
        quotes: true,
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/sales/accounts/:id - Delete account
router.delete('/accounts/:id', requirePermission('sales.accounts.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.account.delete({
      where: { id },
    });

    res.json({ message: 'Account deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// QUOTES
// ============================================

// GET /api/sales/quotes - List quotes
router.get('/quotes', requirePermission('sales.quotes.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, opportunityId, accountId, contactId, ownerId, search } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (status) where.status = status;
    if (opportunityId) where.opportunityId = opportunityId;
    if (accountId) where.accountId = accountId;
    if (contactId) where.contactId = contactId;
    if (ownerId) where.ownerId = ownerId;

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { quoteNumber: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        opportunity: true,
        account: true,
        contact: true,
        items: true,
        _count: {
          select: { activities: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(quotes);
  } catch (error: any) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/sales/quotes/:id - Get quote
router.get('/quotes/:id', requirePermission('sales.quotes.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const quote = await prisma.quote.findFirst({
      where: {
        id,
        orgId: req.org.id,
      },
      include: {
        opportunity: true,
        account: true,
        contact: true,
        items: true,
        activities: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    res.json(quote);
  } catch (error: any) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/sales/quotes - Create quote
router.post('/quotes', requirePermission('sales.quotes.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, opportunityId, accountId, contactId, validUntil, subtotal, taxRate, taxAmount, discount, total, currency, terms, notes, ownerId, items } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    // Generate quote number
    const count = await prisma.quote.count({
      where: { orgId: req.org.id },
    });
    const quoteNumber = `Q-${Date.now()}-${count + 1}`;

    const quote = await prisma.quote.create({
      data: {
        orgId: req.org.id,
        quoteNumber,
        name,
        opportunityId: opportunityId || null,
        accountId: accountId || null,
        contactId: contactId || null,
        validUntil: validUntil ? new Date(validUntil) : null,
        subtotal: subtotal ? Math.round(subtotal * 100) : 0,
        taxRate: taxRate || 0,
        taxAmount: taxAmount ? Math.round(taxAmount * 100) : 0,
        discount: discount ? Math.round(discount * 100) : 0,
        total: total ? Math.round(total * 100) : 0,
        currency: currency || 'SAR',
        terms: terms || null,
        notes: notes || null,
        ownerId: ownerId || null,
        items: items ? {
          create: items.map((item: any) => ({
            name: item.name,
            description: item.description || null,
            quantity: item.quantity || 1,
            unitPrice: Math.round(item.unitPrice * 100),
            discount: item.discount ? Math.round(item.discount * 100) : 0,
            total: Math.round(item.total * 100),
          })),
        } : undefined,
      },
      include: {
        items: true,
        opportunity: true,
        account: true,
        contact: true,
      },
    });

    res.status(201).json(quote);
  } catch (error: any) {
    console.error('Error creating quote:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/quotes/:id - Update quote
router.put('/quotes/:id', requirePermission('sales.quotes.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { items, ...updateData } = req.body;

    // Convert currency amounts
    if (updateData.subtotal) updateData.subtotal = Math.round(updateData.subtotal * 100);
    if (updateData.taxAmount) updateData.taxAmount = Math.round(updateData.taxAmount * 100);
    if (updateData.discount) updateData.discount = Math.round(updateData.discount * 100);
    if (updateData.total) updateData.total = Math.round(updateData.total * 100);
    if (updateData.validUntil) updateData.validUntil = new Date(updateData.validUntil);

    const quote = await prisma.quote.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    // Update items if provided
    if (items !== undefined) {
      await prisma.quoteItem.deleteMany({
        where: { quoteId: id },
      });

      if (items.length > 0) {
        await prisma.quoteItem.createMany({
          data: items.map((item: any) => ({
            quoteId: id,
            name: item.name,
            description: item.description || null,
            quantity: item.quantity || 1,
            unitPrice: Math.round(item.unitPrice * 100),
            discount: item.discount ? Math.round(item.discount * 100) : 0,
            total: Math.round(item.total * 100),
          })),
        });
      }
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: updateData,
      include: {
        items: true,
        opportunity: true,
        account: true,
        contact: true,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating quote:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/quotes/:id/status - Update quote status
router.put('/quotes/:id/status', requirePermission('sales.quotes.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { status } = req.body;

    const quote = await prisma.quote.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: { status },
      include: {
        items: true,
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating quote status:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/sales/quotes/:id - Delete quote
router.delete('/quotes/:id', requirePermission('sales.quotes.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.quote.delete({
      where: { id },
    });

    res.json({ message: 'Quote deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting quote:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// ACTIVITIES
// ============================================

// GET /api/sales/activities - List activities
router.get('/activities', requirePermission('sales.activities.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { type, status, accountId, contactId, leadId, opportunityId, quoteId, assignedToId, dueDateFrom, dueDateTo } = req.query;

    const where: any = {
      orgId: req.org.id,
    };

    if (type) where.type = type;
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (contactId) where.contactId = contactId;
    if (leadId) where.leadId = leadId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (quoteId) where.quoteId = quoteId;
    if (assignedToId) where.assignedToId = assignedToId;

    if (dueDateFrom || dueDateTo) {
      where.dueDate = {};
      if (dueDateFrom) where.dueDate.gte = new Date(dueDateFrom as string);
      if (dueDateTo) where.dueDate.lte = new Date(dueDateTo as string);
    }

    const activities = await prisma.salesActivity.findMany({
      where,
      include: {
        account: true,
        contact: true,
        lead: true,
        opportunity: true,
        quote: true,
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    res.json(activities);
  } catch (error: any) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/sales/activities - Create activity
router.post('/activities', requirePermission('sales.activities.create'), async (req: Request, res: Response) => {
  try {
    if (!req.org || !req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { type, subject, description, dueDate, status, priority, accountId, contactId, leadId, opportunityId, quoteId, assignedToId } = req.body;

    if (!type || !subject) {
      res.status(400).json({ error: 'Type and subject are required' });
      return;
    }

    const activity = await prisma.salesActivity.create({
      data: {
        orgId: req.org.id,
        type,
        subject,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: status || 'not_started',
        priority: priority || 'normal',
        accountId: accountId || null,
        contactId: contactId || null,
        leadId: leadId || null,
        opportunityId: opportunityId || null,
        quoteId: quoteId || null,
        assignedToId: assignedToId || null,
        createdById: req.user.id,
      },
      include: {
        account: true,
        contact: true,
        lead: true,
        opportunity: true,
        quote: true,
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(201).json(activity);
  } catch (error: any) {
    console.error('Error creating activity:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/sales/activities/:id - Update activity
router.put('/activities/:id', requirePermission('sales.activities.edit'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const updateData: any = {};

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        if (key === 'dueDate') {
          updateData[key] = new Date(req.body[key]);
        } else if (key === 'completedAt' && req.body[key]) {
          updateData[key] = new Date(req.body[key]);
        } else {
          updateData[key] = req.body[key];
        }
      }
    });

    const activity = await prisma.salesActivity.findFirst({
      where: { id, orgId: req.org.id },
    });

    if (!activity) {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }

    const updated = await prisma.salesActivity.update({
      where: { id },
      data: updateData,
      include: {
        account: true,
        contact: true,
        lead: true,
        opportunity: true,
        quote: true,
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating activity:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// DELETE /api/sales/activities/:id - Delete activity
router.delete('/activities/:id', requirePermission('sales.activities.delete'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    await prisma.salesActivity.delete({
      where: { id },
    });

    res.json({ message: 'Activity deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting activity:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// WIDGETS
// ============================================

// GET /api/sales/widgets/leads-count - Leads count widget
router.get('/widgets/leads-count', requirePermission('sales.leads.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const total = await prisma.lead.count({
      where: { orgId: req.org.id },
    });

    const byStatus = await prisma.lead.groupBy({
      by: ['status'],
      where: { orgId: req.org.id },
      _count: true,
    });

    res.json({ total, byStatus });
  } catch (error: any) {
    console.error('Error fetching leads count:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/sales/widgets/pipeline-value - Pipeline value widget
router.get('/widgets/pipeline-value', requirePermission('sales.opportunities.view'), async (req: Request, res: Response) => {
  try {
    if (!req.org) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const opportunities = await prisma.opportunity.findMany({
      where: {
        orgId: req.org.id,
        stage: {
          notIn: ['closed_won', 'closed_lost'],
        },
      },
      select: {
        amount: true,
        probability: true,
      },
    });

    const totalValue = opportunities.reduce((sum, opp) => sum + (opp.amount || 0), 0);
    const weightedValue = opportunities.reduce((sum, opp) => sum + ((opp.amount || 0) * (opp.probability || 0) / 100), 0);

    res.json({
      totalValue,
      weightedValue,
      opportunityCount: opportunities.length,
    });
  } catch (error: any) {
    console.error('Error fetching pipeline value:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});










