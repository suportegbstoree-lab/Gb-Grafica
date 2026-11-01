import React from 'react';
import type { Order } from '../types';
import { orderItems } from '../lib/bundles';
import { customerApi, type CustomerApi, type ProductReview } from '../services/customerService';
export default function ProductReviews({
  productId,
  orders,
  uid,
  api = customerApi,
  onChange,
}: {
  key?: string;
  productId: string;
  orders: Order[];
  uid?: string;
  api?: CustomerApi;
  onChange?: () => void;
}) {
  const [rows, setRows] = React.useState<ProductReview[]>([]),
    [rating, setRating] = React.useState(5),
    [comment, setComment] = React.useState(''),
    [error, setError] = React.useState(''),
    [message, setMessage] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const eligible = orders.filter(
    (o) =>
      o.userId === uid &&
      o.paymentStatus === 'pago' &&
      orderItems(o.itens).some((item) => item.productId === productId),
  );
  const [orderId, setOrderId] = React.useState('');
  const alive = React.useRef(true);
  const load = React.useCallback(async () => {
    const data = await api.reviews(productId);
    if (alive.current) setRows(data.reviews);
  }, [api, productId]);
  React.useEffect(() => {
    alive.current = true;
    setRows([]);
    setOrderId('');
    setComment('');
    setRating(5);
    setBusy(false);
    setMessage('');
    setError('');
    void load().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
    };
  }, [load, uid]);
  return (
    <section
      id="avaliacoes"
      className="mx-auto mt-8 max-w-5xl space-y-5 rounded-3xl border border-gray-100 bg-white p-6"
    >
      <h2 className="text-xl font-black text-gray-900">Avaliações de compradores</h2>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-green-700">
          {message}
        </p>
      )}
      {uid && eligible.length > 0 ? (
        <form
          className="space-y-3 rounded-xl bg-gray-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            void api
              .review(productId, { orderId: orderId || eligible[0].id, rating, comment })
              .then(load)
              .then(() => {
                if (alive.current) {
                  setMessage('Avaliação salva. Sua nota anterior deste produto, se houver, foi atualizada.');
                  onChange?.();
                }
              })
              .catch((e) => {
                if (alive.current) setError(e.message);
              })
              .finally(() => {
                if (alive.current) setBusy(false);
              });
          }}
        >
          <label className="block text-sm">
            Compra
            <select
              value={orderId || eligible[0].id}
              onChange={(e) => setOrderId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-3"
            >
              {eligible.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Sua nota
            <select
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="ml-3 rounded-lg border border-gray-200 bg-white p-3"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} estrelas
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Comentário
            <textarea
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white p-3"
              rows={3}
            />
          </label>
          <button disabled={busy} className="rounded-xl bg-pink-500 px-5 py-3 text-sm font-bold text-white">
            {busy ? 'Salvando...' : 'Publicar avaliação'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-gray-500">
          As avaliações podem ser feitas por clientes que compraram este produto com pagamento confirmado.
        </p>
      )}
      {!rows.length && <p className="text-sm text-gray-500">Este produto ainda não tem avaliações.</p>}
      {rows.map((row) => (
        <article key={row.id} className="border-t border-gray-100 pt-4">
          <p className="font-bold text-gray-800">
            {'★'.repeat(row.rating)}
            {'☆'.repeat(5 - row.rating)} · {row.authorName}
          </p>
          <p className="text-xs text-green-700">Compra verificada</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">{row.comment}</p>
        </article>
      ))}
    </section>
  );
}
