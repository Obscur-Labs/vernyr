import { Router, Response } from 'express';
import Notification from '../models/Notification';
import { authenticate, can, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, can('notifications', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const notifications = await Notification.find({ userId: req.user!.id }).sort('-createdAt').limit(limit);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/', authenticate, can('notifications', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.create(req.body);
    res.status(201).json(notification);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
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
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
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
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.patch('/read-all', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.delete('/:id', authenticate, can('notifications', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
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
    res.status(500).json({ message: 'Server error', error: err });
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
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/notifications/bulk
router.post('/bulk', authenticate, can('notifications', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const { action, ids } = req.body;
    if (!action || !Array.isArray(ids) || ids.length === 0) {
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
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
