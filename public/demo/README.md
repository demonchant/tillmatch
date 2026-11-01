# Simulation-only CSV examples

These two files contain fictional illustrative rows for explaining Tillmatch's matching rule. They are not Paystack exports, bank statements, settlement evidence, or real financial activity.

Both files include a `SIMULATION_ONLY` marker. Tillmatch's Paystack and bank import parsers reject any CSV with this marker, so these files cannot be stored in a real closeout. The dashboard's simulation preview is client-only, is prominently labeled, and never calls an application action or writes to the database.

The example intentionally has two exact unique pairs, an unmatched settlement, and unmatched bank credits. It does not infer partial or batched matches.
