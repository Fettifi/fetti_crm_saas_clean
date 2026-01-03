import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';
import { format1003Data } from '@/lib/apply/conversation-logic';

type ApplyStep1Body = {
  applicationId?: string | null;
  contact: {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
};

export async function GET(req: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[API][${requestId}] GET /api/applications - Start`);

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      console.warn(`[API][${requestId}] Missing application ID`);
      return NextResponse.json(
        { error: 'Missing application ID', code: 'MISSING_ID', requestId },
        { status: 400 }
      );
    }

    const { data: application, error } = await supabase
      .from('applications')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !application) {
      console.warn(`[API][${requestId}] Application not found: ${id}`);
      return NextResponse.json(
        { error: 'Application not found', code: 'NOT_FOUND', requestId },
        { status: 404 }
      );
    }

    let applicationData = {};
    if (application.notes) {
      try {
        applicationData = JSON.parse(application.notes);
      } catch (e) {
        console.error(`[API][${requestId}] Error parsing application notes`, e);
        // Continue with empty data rather than failing
      }
    }

    const formattedData = format1003Data(applicationData);
    console.log(`[API][${requestId}] GET /api/applications - Success`);

    return NextResponse.json({
      success: true,
      data: formattedData,
      requestId
    });
  } catch (err) {
    console.error(`[API][${requestId}] Unexpected error in GET /api/applications`, err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR', requestId },
      { status: 500 }
    );
  }
}

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
