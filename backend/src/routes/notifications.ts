import { Router, Response } from 'express';
import Notification from '../models/Notification';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { serverError } from '../utils/httpError';

const router = Router();

router.get('/', authenticate, can('notifications', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const notifications = await Notification.find({ userId: req.user!.id }).sort('-createdAt').limit(limit);
    res.json(notifications);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', authenticate, can('notifications', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, type, title, body, link } = req.body ?? {};
    if (!userId) { res.status(400).json({ message: 'userId is required' }); return; }
    const notification = await Notification.create({ userId, type, title, body, link });
    res.status(201).json(notification);
  } catch (err) {
    serverError(res, err);
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: true },
      { new: true }
    );
    if (!notification) { res.status(404).json({ message: 'Notification not found' }); return; }
    res.json(notification);
  } catch (err) {
    serverError(res, err);
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH aliases (used by student portal)
router.patch('/:id/read', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: true },
      { new: true }
    );
    if (!notification) { res.status(404).json({ message: 'Notification not found' }); return; }
    res.json(notification);
  } catch (err) {
    serverError(res, err);
  }
});

router.patch('/read-all', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', authenticate, can('notifications', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    serverError(res, err);
  }
});

// PUT /api/notifications/:id/unread
router.put('/:id/unread', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: false },
      { new: true }
    );
    if (!notification) { res.status(404).json({ message: 'Notification not found' }); return; }
    res.json(notification);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/notifications/:id/unread
router.patch('/:id/unread', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: false },
      { new: true }
    );
    if (!notification) { res.status(404).json({ message: 'Notification not found' }); return; }
    res.json(notification);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/notifications/bulk
router.post('/bulk', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const { action, ids } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0 || ids.length > 500 ||
        !ids.every((id) => typeof id === 'string')) {
      res.status(400).json({ message: 'Invalid payload. Action and ids are required.' });
      return;
    }

    if (action === 'read') {
      await Notification.updateMany(
        { _id: { $in: ids }, userId: req.user!.id },
        { read: true }
      );
    } else if (action === 'unread') {
      await Notification.updateMany(
        { _id: { $in: ids }, userId: req.user!.id },
        { read: false }
      );
    } else if (action === 'delete') {
      await Notification.deleteMany(
        { _id: { $in: ids }, userId: req.user!.id }
      );
    } else {
      res.status(400).json({ message: 'Invalid action. Must be read, unread, or delete.' });
      return;
    }

    res.json({ message: `Bulk action ${action} completed successfully.` });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
