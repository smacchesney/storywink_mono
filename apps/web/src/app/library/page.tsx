import { LibraryClientView } from "./library-client-view"; // Import the original Client Component
import { getUserBooks } from "./actions";

export default async function LibraryPage() {
  // Fetch data server-side
  const initialData = await getUserBooks();
  
  // Pass data to client component
  return <LibraryClientView initialData={initialData} />;
} 