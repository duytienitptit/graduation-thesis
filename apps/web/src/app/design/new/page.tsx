'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppHeader } from '@/components/app-header';
import { ErrorNote } from '@/components/error-note';
import { Button } from '@/components/ui/button';
import { ApiError, createSession, listProducts, Product } from '@/lib/api';
import { useUser } from '@/lib/use-user';

const OPTION =
  'cursor-pointer border border-mist bg-white/60 px-4 py-2 transition-colors hover:border-cobalt has-checked:border-cobalt has-checked:bg-cobalt has-checked:text-white has-focus-visible:ring-3 has-focus-visible:ring-ring/50';

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-8">
      <legend className="font-semibold">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export default function NewDesignPage() {
  const router = useRouter();
  const { user } = useUser();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState('');
  const [colourId, setColourId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    listProducts()
      .then(setProducts)
      .catch((e: ApiError) => setError(e.message));
  }, [user]);

  const product = products?.find((candidate) => candidate.id === productId);
  const validQuantity = /^[1-9]\d*$/.test(quantity);
  const ready = product && colourId && materialId && size && validQuantity;

  function chooseProduct(id: string) {
    setProductId(id);
    // Options differ per product, so earlier choices may no longer exist.
    setColourId('');
    setMaterialId('');
    setSize('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const session = await createSession({
        productId,
        colourId,
        materialId,
        size,
        quantity: Number(quantity),
      });
      router.push(`/design/${session.id}`);
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <AppHeader user={user} />

      <main className="mt-10">
        <h1 className="overprint text-6xl font-extrabold sm:text-7xl">Chọn áo</h1>

        <form onSubmit={submit}>
          <fieldset className="mt-8">
            <legend className="font-semibold">Loại áo</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {products?.map((option) => (
                <label key={option.id} className={`${OPTION} py-5 text-center text-lg font-medium`}>
                  <input
                    type="radio"
                    name="product"
                    className="sr-only"
                    checked={productId === option.id}
                    onChange={() => chooseProduct(option.id)}
                  />
                  {option.name}
                </label>
              ))}
            </div>
          </fieldset>

          {product && (
            <>
              <Group legend="Màu áo">
                {product.colours.map((colour) => (
                  <label key={colour.id} className={`${OPTION} flex items-center gap-2`}>
                    <input
                      type="radio"
                      name="colour"
                      className="sr-only"
                      checked={colourId === colour.id}
                      onChange={() => setColourId(colour.id)}
                    />
                    <span
                      aria-hidden
                      className="size-4 rounded-full border border-mist"
                      style={{ background: colour.hex }}
                    />
                    {colour.name}
                  </label>
                ))}
              </Group>

              <Group legend="Chất liệu">
                {product.materials.map((material) => (
                  <label key={material.id} className={OPTION}>
                    <input
                      type="radio"
                      name="material"
                      className="sr-only"
                      checked={materialId === material.id}
                      onChange={() => setMaterialId(material.id)}
                    />
                    {material.name}
                  </label>
                ))}
              </Group>

              <Group legend="Size">
                {product.sizes.map((option) => (
                  <label key={option} className={OPTION}>
                    <input
                      type="radio"
                      name="size"
                      className="sr-only"
                      checked={size === option}
                      onChange={() => setSize(option)}
                    />
                    {option}
                  </label>
                ))}
              </Group>

              <div className="mt-8">
                <label htmlFor="quantity" className="font-semibold">
                  Số lượng
                </label>
                <input
                  id="quantity"
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="mt-3 block w-32 border border-mist bg-white px-3 py-2 outline-none focus-visible:border-cobalt focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>

              <Button type="submit" size="lg" className="mt-8" disabled={!ready || busy}>
                {busy ? 'Đang tạo…' : 'Tiếp tục'}
              </Button>
            </>
          )}
        </form>

        {error && <ErrorNote>{error}</ErrorNote>}
      </main>
    </div>
  );
}
