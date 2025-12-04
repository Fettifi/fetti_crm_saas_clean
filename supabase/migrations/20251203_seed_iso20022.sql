-- Seed Rupee's Memory with ISO 20022 Knowledge

insert into rupee_memory (topic, insight) values
('ISO 20022', 'ISO 20022 is the new global standard for financial messaging, replacing SWIFT MT. It uses rich, structured XML data.'),
('ISO 20022 Migration Deadline', 'SWIFT cross-border payments must migrate to ISO 20022 by November 2025. The coexistence period ends then.'),
('Fedwire ISO 20022', 'The US Fedwire Funds Service migrates to ISO 20022 on July 14, 2025, in a single-day cutover.'),
('ISO 20022 Benefits', 'Rich data enables better fraud detection, higher straight-through processing (STP), and improved compliance.'),
('ISO 20022 Structure', 'Messages contain granular data fields (e.g., separate fields for street, city, country) unlike the unstructured text blocks of MT messages.');
