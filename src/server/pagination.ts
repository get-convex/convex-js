/**
 * An opaque identifier used for paginating a database query.
 *
 * Cursors are returned from {@link OrderedQuery.paginate} and represent the
 * point of the query where the page of results ended.
 *
 * To continue paginating, pass the cursor back into
 * {@link OrderedQuery.paginate} in the {@link PaginationOptions} object to
 * fetch another page of results.
 *
 * Note: Cursors can only be passed to _exactly_ the same database query that
 * they were generated from. You may not reuse a cursor between different
 * database queries.
 *
 * @public
 */
export type Cursor = string;

/**
 * The result of paginating using {@link OrderedQuery.paginate}.
 *
 * @public
 */
export interface PaginationResult<T> {
  /**
   * The page of results.
   */
  page: T[];

  /**
   * Have we reached the end of the results?
   */
  isDone: boolean;

  /**
   * A {@link Cursor} to continue loading more results.
   */
  continueCursor: Cursor;
}

/**
 * The options passed to {@link OrderedQuery.paginate}.
 *
 * @public
 */
export interface PaginationOptions {
  /**
   * Number of items to load in this page of results.
   *
   * Note: This is only an initial value!
   *
   * If you are running this paginated query in a reactive query function, you
   * may receive more or less items than this if items were added to or removed
   * from the query range.
   */
  numItems: number;

  /**
   * A {@link Cursor} representing the start of this page or `null` to start
   * at the beginning of the query results.
   */
  cursor: Cursor | null;

  /**
   * What is the maximum number of rows that should be read from the database? This option
   * is different from `numItems` in that it controls the number of rows entering a query's
   * pipeline, where `numItems` controls the number of rows coming out. For example, a `filter`
   * may disqualify most of the rows coming in, so setting a low `numItems` would not help
   * bound its execution time. Instead, set a low `maximumRowsRead` to efficiently paginate
   * through the filter.
   *
   * @internal
   */
  maximumRowsRead?: number;
}
