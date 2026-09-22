import { redirect } from 'next/navigation';

/**
 * The dashboard is the front door. Landing on the meetings list answered
 * "what calls are there"; the question someone opens this product with is
 * "how are we doing", and only the dashboard answers that.
 */
export default function Home() {
  redirect('/dashboard');
}
