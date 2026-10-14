import { Invoice } from '../models/Invoice.js';
import { broadcastRealtimeUpdate } from '../services/realtimeService.js';
import mongoose from 'mongoose';

const findByIdOrCustomId = (id) => {
  if (mongoose.isValidObjectId(id)) {
    return { $or: [{ _id: id }, { customId: id }] };
  }
  return { customId: id };
};

export const getInvoices = async (req, res, next) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json({ success: true, data: invoices });
  } catch (err) {
    next(err);
  }
};

export const createInvoice = async (req, res, next) => {
  try {
    const { client, amount, dueDate, status, date } = req.body;
    const newInvoice = await Invoice.create({
      customId: 'inv_' + Math.random().toString(36).substring(2, 9),
      client: client || 'New Client',
      amount: amount || '₹0',
      dueDate: dueDate || '',
      date: date || new Date().toISOString().split('T')[0],
      status: status || 'pending'
    });

    broadcastRealtimeUpdate('INVOICE_UPDATED', { invoice: newInvoice });
    res.status(201).json({ success: true, message: `Invoice generated for ${newInvoice.client}`, data: newInvoice });
  } catch (err) {
    next(err);
  }
};

export const updateInvoiceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updated = await Invoice.findOneAndUpdate(
      findByIdOrCustomId(id),
      { status },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }
    broadcastRealtimeUpdate('INVOICE_UPDATED', { invoice: updated });
    res.json({ success: true, message: `Invoice status updated to ${status}`, data: updated });
  } catch (err) {
    next(err);
  }
};

export const getFinanceSummary = async (req, res, next) => {
  try {
    const invoices = await Invoice.find();
    let totalRevenue = 0;
    let pendingRevenue = 0;
    let overdueRevenue = 0;

    invoices.forEach((inv) => {
      const cleanAmt = parseFloat((inv.amount || '0').replace(/[^0-9.-]+/g, '')) || 0;
      if (inv.status === 'paid') totalRevenue += cleanAmt;
      else if (inv.status === 'pending') pendingRevenue += cleanAmt;
      else if (inv.status === 'overdue') overdueRevenue += cleanAmt;
    });

    res.json({
      success: true,
      data: {
        totalRevenue: `₹${totalRevenue.toLocaleString('en-IN')}`,
        pendingRevenue: `₹${pendingRevenue.toLocaleString('en-IN')}`,
        overdueRevenue: `₹${overdueRevenue.toLocaleString('en-IN')}`,
        totalInvoices: invoices.length
      }
    });
  } catch (err) {
    next(err);
  }
};

export const deleteInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await Invoice.findOneAndDelete(findByIdOrCustomId(id));
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }
    broadcastRealtimeUpdate('INVOICE_DELETED', { id, invoice: deleted });
    res.json({ success: true, message: `Invoice for ${deleted.client} deleted.`, data: deleted });
  } catch (err) {
    next(err);
  }
};

