import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

type ApplyStep1Body = {
  applicationId?: string | null;
  contact: {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ApplyStep1Body;
    const { applicationId, contact } = body;

    if (!contact || !contact.firstName) {
      return NextResponse.json(
        { error: 'Missing required contact.firstName' },
        { status: 400 }
      );
    }

    const { data: contactRow, error: contactError } = await supabase
      .from('contacts')
      .insert({
        first_name: contact.firstName,
        last_name: contact.lastName ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
      })
      .select('id')
      .single();

    if (contactError || !contactRow) {
      console.error('Error inserting contact', contactError);
      return NextResponse.json(
        { error: 'Unable to create contact' },
        { status: 500 }
      );
    }

    const contactId = contactRow.id as string;

    let finalApplicationId = applicationId ?? null;

    if (!finalApplicationId) {
      const { data: appRow, error: appError } = await supabase
        .from('applications')
        .insert({
          contact_id: contactId,
          status: 'STARTED',
        })
        .select('id')
        .single();

      if (appError || !appRow) {
        console.error('Error inserting application', appError);
        return NextResponse.json(
          { error: 'Unable to create application' },
          { status: 500 }
        );
      }

      finalApplicationId = appRow.id as string;
    } else {
      const { error: updateError } = await supabase
        .from('applications')
        .update({ contact_id: contactId })
        .eq('id', finalApplicationId);

      if (updateError) {
        console.error('Error updating application contact', updateError);
        return NextResponse.json(
          { error: 'Unable to update application contact' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      applicationId: finalApplicationId,
      contactId,
    });
  } catch (err) {
    console.error('Unexpected error in /api/applications', err);
    return NextResponse.json(
      { error: 'Unexpected server error' },
      { status: 500 }
    );
  }
}
