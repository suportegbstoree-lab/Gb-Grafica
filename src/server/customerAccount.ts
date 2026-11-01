import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { EMPTY_PROFILE, parseCustomerProfile } from '../lib/customerProfile.js';
import { orderItems } from '../lib/bundles.js';
import { OperationsError } from '../lib/operations.js';
type Deps = {
  db: () => Firestore;
  user: (req: express.Request) => Promise<{ uid: string; name?: string }>;
  limit: (key: string, count: number, ms: number) => void;
};
export function createCustomerAccountRouters(deps: Deps) {
  const account = express.Router(),
    products = express.Router();
  const action =
    (fn: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler =>
    (req, res, next) => {
      void fn(req, res).catch(next);
    };
  account.use((req, res, next) => {
    void deps
      .user(req)
      .then((user) => {
        deps.limit(`account:${user.uid}`, 30, 60000);
        res.locals.customer = user;
        res.setHeader('Cache-Control', 'private, no-store');
        next();
      })
      .catch(next);
  });
  const profileView = (data: any) =>
    Object.fromEntries(Object.entries(EMPTY_PROFILE).map(([key, fallback]) => [key, data?.[key] ?? fallback]));
  account.get(
    '/profile',
    action(async (_req, res) => {
      const data = (await deps.db().collection('_customerProfiles').doc(res.locals.customer.uid).get()).data();
      res.json(profileView(data));
    }),
  );
  account.post(
    '/profile',
    action(async (req, res) => {
      const value = parseCustomerProfile(req.body);
      if (!value || !(req.body.expectedRevision === null || typeof req.body.expectedRevision === 'string'))
        throw new OperationsError('Revise os dados pessoais, CPF, telefone e endereço.', 422);
      const db = deps.db(),
        ref = db.collection('_customerProfiles').doc(res.locals.customer.uid);
      await db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data();
        if ((old?.revision || null) !== req.body.expectedRevision)
          throw new OperationsError('O perfil mudou. Atualize a página antes de salvar.', 409);
        tx.set(ref, { ...value, revision: randomUUID(), updatedAt: new Date().toISOString() });
      });
      res.json(profileView((await ref.get()).data()));
    }),
  );
  account.get(
    '/orders',
    action(async (_req, res) => {
      const rows = await deps.db().collection('orders').where('userId', '==', res.locals.customer.uid).get();
      res.json({
        orders: rows.docs
          .map((doc) => ({ ...doc.data(), id: doc.id }))
          .sort((a: any, b: any) => String(b.data).localeCompare(String(a.data))),
      });
    }),
  );
  products.get(
    '/ratings',
    action(async (_req, res) => {
      const rows = await deps.db().collection('productRatings').get();
      res.json({
        ratings: Object.fromEntries(
          rows.docs.map((doc) => [
            doc.id,
            { count: doc.data().count, sum: doc.data().sum, average: doc.data().average },
          ]),
        ),
      });
    }),
  );
  products.get(
    '/:id/reviews',
    action(async (req, res) => {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(req.params.id)) throw new OperationsError('Produto inválido.', 422);
      const db = deps.db(),
        reviews = await db
          .collection('anuncios')
          .doc(req.params.id)
          .collection('reviews')
          .orderBy('updatedAt', 'desc')
          .limit(50)
          .get();
      res.json({
        reviews: reviews.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        rating: (await db.collection('productRatings').doc(req.params.id).get()).data() || {
          count: 0,
          sum: 0,
          average: 0,
        },
      });
    }),
  );
  products.post(
    '/:id/reviews',
    action(async (req, res) => {
      const user = await deps.user(req);
      deps.limit(`review:${user.uid}`, 10, 60000);
      const { rating, comment, orderId } = req.body || {},
        id = req.params.id;
      if (
        !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
        typeof orderId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(orderId) ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5 ||
        typeof comment !== 'string' ||
        comment.trim().length > 2000 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(comment)
      )
        throw new OperationsError('Use uma nota de 1 a 5 e comentário de até 2.000 caracteres.', 422);
      const db = deps.db(),
        key = createHash('sha256').update(`${user.uid}:${id}`).digest('hex'),
        ref = db.collection('anuncios').doc(id).collection('reviews').doc(key),
        aggregate = db.collection('productRatings').doc(id);
      await db.runTransaction(async (tx) => {
        const [orderSnap, productSnap, previous, totals] = await Promise.all([
          tx.get(db.collection('orders').doc(orderId)),
          tx.get(db.collection('anuncios').doc(id)),
          tx.get(ref),
          tx.get(aggregate),
        ]);
        const order = orderSnap.data();
        if (
          !order ||
          order.userId !== user.uid ||
          order.paymentStatus !== 'pago' ||
          Number(order.pagbankRefundedAmountCents) > 0 ||
          !Array.isArray(order.itens) ||
          !orderItems(order.itens).some((item) => item.productId === id)
        )
          throw new OperationsError('Somente quem comprou este produto com pagamento confirmado pode avaliá-lo.', 403);
        if (!productSnap.exists) throw new OperationsError('Produto não encontrado.', 404);
        const old = previous.data(),
          current = totals.data(),
          count = Number(current?.count || 0) + (old ? 0 : 1),
          sum = Number(current?.sum || 0) - Number(old?.rating || 0) + rating,
          now = new Date().toISOString();
        tx.set(ref, {
          rating,
          comment: comment.trim(),
          authorName:
            String(user.name || 'Cliente')
              .trim()
              .split(/\s+/)[0]
              .slice(0, 50) || 'Cliente',
          verifiedPurchase: true,
          createdAt: old?.createdAt || now,
          updatedAt: now,
        });
        tx.set(aggregate, { count, sum, average: sum / count });
        tx.set(db.collection('_reviewOwners').doc(key), { uid: user.uid, orderId, productId: id, updatedAt: now });
      });
      res.json({ saved: true });
    }),
  );
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof OperationsError ? error.status : typeof error?.status === 'number' ? error.status : 500;
    res.status(status).json({ error: status < 500 ? error.message : 'Não foi possível acessar os dados agora.' });
  };
  account.use(errors);
  products.use(errors);
  return { account, products };
}
