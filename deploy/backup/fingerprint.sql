-- Empreinte des données de l'application : pour chaque table de public, nombre de lignes et
-- empreinte MD5 du contenu. Deux bases identiques donnent la même sortie (test de restauration).
SELECT format(
  'SELECT %L || %L || count(*) || %L || md5(coalesce(string_agg(t::text, %L ORDER BY t::text), %L)) FROM public.%I t',
  tablename, ' ', ' ', '|', '', tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
