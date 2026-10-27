import { createContext, useContext } from 'react';

export type Base = '/student' | '/faculty' | '/admin';
/** Route prefix of the layout a page is rendered in. Lets one page component be reused by faculty and admin. */
export const BaseContext = createContext<Base>('/student');
export const useBase = () => useContext(BaseContext);
