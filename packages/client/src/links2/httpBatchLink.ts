import { AnyRouter, ProcedureType } from '@trpc/server';
import { dataLoader } from '../internals/dataLoader';
import { observable } from '../rx/observable';
import { TRPCLink } from './core';
import { HTTPLinkOptions, httpRequest, ResponseShape } from './httpUtils';
import { transformOperationResult } from './transformerLink';

export function httpBatchLink<TRouter extends AnyRouter>(
  opts: HTTPLinkOptions,
): TRPCLink<TRouter> {
  const { url } = opts;
  return (runtime) =>
    ({ op }) => {
      type Key = { id: number; path: string; input: unknown };
      const fetcher = (type: ProcedureType) => (keyInputPairs: Key[]) => {
        const path = keyInputPairs.map((op) => op.path).join(',');
        const inputs = keyInputPairs.map((op) => op.input);

        const { promise, cancel } = httpRequest({
          url,
          inputs,
          path,
          runtime,
          type,
        });

        return {
          promise: promise.then((res) => {
            const resJSON = Array.isArray(res.json)
              ? res.json
              : keyInputPairs.map(() => res.json);

            const result = resJSON.map((item) => ({
              meta: res.meta,
              json: item,
            }));

            return result;
          }),
          cancel,
        };
      };
      const query = dataLoader<Key, ResponseShape>(fetcher('query'));
      const mutation = dataLoader<Key, ResponseShape>(fetcher('mutation'));
      const subscription = dataLoader<Key, ResponseShape>(
        fetcher('subscription'),
      );

      const loaders = { query, subscription, mutation };
      return observable((observer) => {
        const loader = loaders[op.type];
        const { promise, cancel } = loader.load(op);

        promise
          .then((res) =>
            observer.next(
              transformOperationResult(
                {
                  meta: res.meta,
                  data: res.json as any,
                },
                runtime.transformer,
              ),
            ),
          )
          .catch((err) => observer.error(err as any))
          .finally(() => observer.complete());

        return () => {
          cancel();
        };
      });
    };
}